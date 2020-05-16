'use strict';

const Homey = require('homey');

// Lamp will disconnect after 8 seconds inactivity
const COMMAND_QUEUE_RETRY = 4;
const BLE_DISCONNECT_TIMEOUT = 6;

const {
	SERVICE_UUID,
	API_CHARACTERISTIC_UUID,
} = require('../../config');

class SmartLampDevice extends Homey.Device {

	static get LAMP_WATT_MIN() {
		return 0.5;
	}

	static get LAMP_WATT_MAX() {
		return 75;
	}

	onInit() {
		this.log('SmartLampDevice has been inited');
		this.setUnavailable();

		this.registerMultipleCapabilityListener([
			'onoff',
			'dim',
			'light_hue',
			'light_saturation',
			'light_mode',
			'light_temperature'
		], this._onCapabilityLight.bind(this), 300);
		
		const {id} = this.getData();
		const driver = this.getDriver();

		this._connectionTimer = null;
		this._commandBusy = false;
		this._commandQueue = [];
		this._commandRetry = 0;

		driver.ready(() => {
			try {
				this._device = driver.getSmartLamp(id);
				this._onDeviceInit();
			} catch(err) {
				driver.once(`device:${id}`, device => {
					this._device = device;
					this._onDeviceInit();
				});
			}
		});
	}

	async _onDeviceInit() {
		this.setAvailable();
		this.calculatePower();
	}

	_connectionTimerStart(timeout) {
		this._connectionTimerStop();

		if (timeout > 0) {
			this._connectionTimer = setTimeout(() => {
				this._connectionTimer = null;
				this._disconnect();
			}, timeout * 1000);
		}
	}

	_connectionTimerStop() {
		if (this._connectionTimer) {
			clearTimeout(this._connectionTimer);
			this._connectionTimer = null;
		}
	}

	_delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async _getService() {
		/* Already connected? */
		if (this._peripheral && this._peripheral.isConnected) {
			this.log('_getService already connected');
			this._connectionTimerStart(BLE_DISCONNECT_TIMEOUT);
			const BLEservice = await this._peripheral.getService(SERVICE_UUID);
			return Promise.resolve(BLEservice);
		}

		/* Already trying to connect */
		if (this._connectionTimer) {
			this.log('_getService connection already started');
			this._connectionTimerStart(BLE_DISCONNECT_TIMEOUT);
			return Promise.resolve(null);
		}

		/* Connecting */
		this.log('_getService connecting');
		this._connectionTimerStart(BLE_DISCONNECT_TIMEOUT);
		this._peripheral = await this._device.connect();

		await this._peripheral.discoverAllServicesAndCharacteristics();
		const BLEservice = await this._peripheral.getService(SERVICE_UUID);

		if (!BLEservice) {
			this.log('_getService missing service');
			return Promise.reject(new Error('missing_service'));
		}

		return Promise.resolve(BLEservice);
	}

	async _disconnect() {
		this.log('_disconnect');

		this._commandBusy = true;
		this._connectionTimerStop();

		if (this._peripheral && this._peripheral.isConnected) {
			this.log('_disconnect peripheral');
			await this._peripheral.disconnect().catch(() => null);
		}

		this._commandBusy = false;

		delete this._peripheral;

		// Check if Queue is empty
		setTimeout(() => { this._processQueue(true); }, 500);

		return Promise.resolve(true);
	}

	async _processQueue(retry) {
		this.log('_processQueue', this._commandRetry, this._commandQueue.length);

		if (retry)
			this._commandRetry++;

		if (this._commandRetry >= COMMAND_QUEUE_RETRY) {
			this.log('_processQueue retries exceeded');
			this._commandQueue = [];
			this._commandRetry = 0;
		}

		if (this._commandQueue.length == 0) {
			this.log('_processQueue empty');
			return Promise.resolve(true);
		}

		try {
			if (this._commandBusy) {
				this.log('_processQueue is busy');
				return Promise.resolve(true);
			}

			const service = await this._getService();

			if (!service) {
				this.log('_processQueue service missing');
				setTimeout(() => { this._processQueue(true); }, 500);
				return Promise.reject(new Error('missing_service'));
			}

			this._commandBusy = true;

			while (this._commandQueue.length > 0) {
				this._connectionTimerStart(BLE_DISCONNECT_TIMEOUT);
				const command = this._commandQueue.shift();

				this.log('_processQueue writing', command);

				await service.write(API_CHARACTERISTIC_UUID, command)
					.catch((error) => {
						this.log(error.message);
					});

				/* Wait between commands, if send to fast this gives weird behaviour.
				 * Ideally we should wait for a response, but the Homey API is limited.
				 */
				await this._delay(250);
			}

			this._commandRetry = 0;
			this._commandBusy = false;

			return Promise.resolve(true);
		} catch (error) {
			this.log(error.message);
			this._disconnect();

			return Promise.reject(error);
		}
	}

	async _api(cmd, data) {
		this.log('_api', cmd, data);

		let v = 0x01;

		if (cmd > 4)
			v = 0x02;

		this._commandQueue.push(Buffer.concat([Buffer.from([ 0xA0, v, cmd ]), data]));
		await this._processQueue(false);

		return Promise.resolve(true);
	}

	async _onCapabilityLight(valueObj) {
		// if only onoff or brightness
		if (Object.keys(valueObj).length === 1) {
			if (typeof valueObj.onoff === 'boolean') {
				if (valueObj.onoff === false)
					return this.setScene({ id: 0x00 });

				return this.setScene({ id: 0xFF });
			} else if (typeof valueObj.dim === 'number') {
				/* Any change will turn on the light */
				if (!this.getCapabilityValue('onoff'))
					this.setScene({ id: 0xFF });

				const buf = Buffer.alloc(1);
				buf.writeUInt8(Math.round(valueObj.dim * 100), 0);

				return this._api(3, buf);
			}
		}

		let {
			dim = this.getCapabilityValue('dim'),
			light_hue = this.getCapabilityValue('light_hue'),
			light_saturation = this.getCapabilityValue('light_saturation'),
			light_mode = this.getCapabilityValue('light_mode'),
			light_temperature = this.getCapabilityValue('light_temperature'),
		} = valueObj;

		if (dim === null) dim = 0.5;
		if (light_hue === null) light_hue = 0;
		if (light_saturation === null) light_saturation = 1;
		if (light_mode === null) light_mode = 'color';
		if (light_temperature === null) light_temperature = 0.5;

		/* Any change will turn on the light */
		if (!this.getCapabilityValue('onoff'))
			this.setScene({ id: 0xFF });

		/* Dimming from flow has 2 arguments, we only want to dim, not change colors */
		if (Object.keys(valueObj).length === 2 && typeof valueObj.dim === 'number') {
			const buf = Buffer.alloc(1);
			buf.writeUInt8(Math.round(valueObj.dim * 100), 0);

			return this._api(3, buf);
		}

		/* Uplight */
		if (light_mode === 'color') {
			const buf = Buffer.alloc(7);
			buf.writeUInt8(0x01, 0); // Flag
			buf.writeUInt16BE(0x00, 1); // Duration, 0 = infinite
			buf.writeUInt8(Math.round(light_saturation * 255), 3); // Saturation
			buf.writeUInt16BE(Math.round(light_hue * 65535), 4); // Hue
			buf.writeUInt8(Math.round(dim * 100), 6); // Brightness

			return this._api(2, buf);
		/* Downlight */
		} else {
			const buf = Buffer.alloc(6);
			buf.writeUInt8(0x02, 0); // Flag
			buf.writeUInt16BE(0x00, 1); // Duration, 0 = infinite
			buf.writeUInt16BE(Math.round((1 - light_temperature) * (4000 - 2700) + 2700), 3); // Color Temperature
			buf.writeUInt8(Math.round(dim * 100), 5); // Brightness

			return this._api(2, buf);
		}
	}

	async getScenes() {
		let scenes = [];
		scenes.push({ id: 0x00, name: 'Off'});
		scenes.push({ id: 0xFF, name: 'Last scene'});

		/* As we cannot read the scenes names yet just create a list */
		for (let i = 0x01; i <= 0xFE; i++)
			scenes.push({ id: i, name: 'id: ' + i})

		return scenes;
	}

	async setScene({ id }) {
		if (id === 0x00 && this.getCapabilityValue('onoff'))
			await this.setCapabilityValue('onoff', false);
		else if (!this.getCapabilityValue('onoff'))
			await this.setCapabilityValue('onoff', true);

		this.calculatePower();

		const buf = Buffer.alloc(1);
		buf.writeUInt8(id, 0);

		return this._api(5, buf);
	}

	async calculatePower() {
		/* Check if capability exists */
		if(!this.hasCapability('measure_power')) {
			if (typeof this.addCapability === 'function') {
					await this.addCapability('measure_power');
					await this.setCapabilityOptions('measure_power', {
						approximated: true,
					});
			} else {
				return;
			}
		}

		const {
			LAMP_WATT_MIN,
			LAMP_WATT_MAX,
		} = this.constructor;

		let onoff = this.getCapabilityValue('onoff');
		let dim = this.getCapabilityValue('dim');

		if( !onoff )
			dim = 0;

		const usage = LAMP_WATT_MIN + ((LAMP_WATT_MAX - LAMP_WATT_MIN) * dim);

		this.setCapabilityValue('measure_power', usage).catch(this.error);
	}
}

module.exports = SmartLampDevice;
'use strict';

const Homey = require('homey');
const CloudApi = require('../cloud.js');

class SmartLampCloudDevice extends Homey.Device {

	static get LAMP_WATT_MIN() {
		return 0.5;
	}

	static get LAMP_WATT_MAX() {
		return 75;
	}

	onInit() {
		this.log('SmartLampCloudDevice has been inited');

		this.registerMultipleCapabilityListener([
			'onoff',
			'dim',
			'light_temperature'
		], this._onCapabilityLight.bind(this), 300);

		this.cloudApi = new CloudApi();

		this._onDeviceInit();
	}

	async _onDeviceInit() {
		this.calculatePower();
	}

	async _onCapabilityLight(valueObj) {
		const device = this.getData();

		// If only onoff or brightness
		if (Object.keys(valueObj).length === 1) {
			if (typeof valueObj.onoff === 'boolean') {
				return new Promise((resolve, reject) => {
					this.cloudApi.Command(device.key, device.id, '{"power":"' + (valueObj.onoff ? "ON" : "OFF") + '"}', async (error, response) => {
						if (error)
							return reject(error);

						this.calculatePower();
						return resolve(true);
					});
				});
			} else if (typeof valueObj.dim === 'number') {
				/* Any change will turn on the light */
				if (!this.getCapabilityValue('onoff'))
					this.setCapabilityValue('onoff', true);

				return new Promise((resolve, reject) => {
					this.cloudApi.Command(device.key, device.id, '{"brightness":' + (valueObj.dim * 100) + ',"relative":false}', async (error, response) => {
						if (error)
							return reject(error);

						this.calculatePower();
						return resolve(true);
					});
				});
			}
		}

		let {
			dim = this.getCapabilityValue('dim'),
			light_temperature = this.getCapabilityValue('light_temperature'),
		} = valueObj;

		if (dim === null) dim = 0.5;
		if (light_temperature === null) light_temperature = 0.5;

		/* Any change will turn on the light */
		if (!this.getCapabilityValue('onoff'))
			this.setCapabilityValue('onoff', true);

		/* Dimming from flow has 2 arguments, we only want to dim, not change colors */
		if (Object.keys(valueObj).length === 2 && typeof valueObj.dim === 'number') {
			return new Promise((resolve, reject) => {
				this.cloudApi.Command(device.key, device.id, '{"brightness":' + (valueObj.dim * 100) + ',"relative":false}', async (error, response) => {
					if (error)
						return reject(error);

					this.calculatePower();
					return resolve(true);
				});
			});
		}

		return new Promise((resolve, reject) => {
			this.cloudApi.Command(device.key, device.id, '{"kelvin":' + Math.round((1 - light_temperature) * (4000 - 2700) + 2700) + '}', async (error, response) => {
				if (error)
					return reject(error);

				this.calculatePower();
				return resolve(true);
			});
		});
	}

	async getScenes() {
		let scenes = [];
		scenes.push({ id: 0x00, name: 'Off'});
		scenes.push({ id: 0xFF, name: 'Last scene'});

		/* As we cannot read the scenes names yet just create a list */
		for (let i = 1; i <= 31; i++)
			scenes.push({ id: i, name: 'id: ' + i})

		return scenes;
	}

	async setScene({ id }) {
		const device = this.getData();

		if (id === 0x00 && this.getCapabilityValue('onoff'))
			await this.setCapabilityValue('onoff', false);
		else if (!this.getCapabilityValue('onoff'))
			await this.setCapabilityValue('onoff', true);

		return new Promise((resolve, reject) => {
			this.cloudApi.Command(device.key, device.id, '{"scene":' + id + '}', async (error, response) => {
				if (error)
					reject(error);

				this.calculatePower();
				resolve(true);
			});
		});
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

module.exports = SmartLampCloudDevice;
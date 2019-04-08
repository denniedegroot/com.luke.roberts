'use strict';

const Homey = require('homey');
const {
	SERVICE_UUID,
} = require('../../config');

class SmartLampDriver extends Homey.Driver {

	onInit() {
		this.log('SmartLampDriver has been inited');
		
		this._devices = {};
		this.discover();
		
		new Homey.FlowCardAction('set_scene')
			.register()
			.registerRunListener(({ device, scene }) => {
				return device.setScene(scene);
			})
			.getArgument('scene')
			.registerAutocompleteListener(async (query, { device }) => {
				const scenes = await device.getScenes();
				return scenes.filter(scene => {
					return scene.name.toLowerCase().indexOf(query.toLowerCase()) > -1;
				});
			});
	}

	discover() {
		Homey.ManagerBLE.discover([ SERVICE_UUID ], 1000)
			.then(devices => {
				devices.forEach(device => {
					if( this._devices[device.id] ) return;
					this.log(`Found device: ${device.id}`)
					this._devices[device.id] = device;
					this.emit(`device:${device.id}`, device);
				})
			})
			.catch(this.error);
	}

	onPairListDevices( data, callback ) {
		callback( null, Object.keys(this._devices).map(deviceId => {
			return {
				name: 'Smart Lamp',
				data: {
					id: deviceId,
				}
			}
		}));
	}

	getSmartLamp(id) {
		if( !this._devices[id] )
			throw new Error('invalid_device');
			
		return this._devices[id];
	}

}

module.exports = SmartLampDriver;
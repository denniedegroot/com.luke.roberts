'use strict';

const Homey = require('homey');
const CloudApi = require('../cloud.js');

class SmartLampDriverCloud extends Homey.Driver {

	onInit() {
		this.log('SmartLampDriverCloud has been inited');

		this._devices = {};

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

	onPairListDevices( data, callback ) {
		const cloudApi = new CloudApi();
		let foundDevices = [];

		cloudApi.Discover('', async (error, discovered_devices) => {
			if (error)
				return callback(error, null);

			await Promise.all(discovered_devices.map((device) => {
				foundDevices.push({
					name: device.name,
					data: {
						id: device.id,
						api: device.api_version,
						key: ''
					}
				});
			}));

			callback(null, foundDevices);
		});
	}

}

module.exports = SmartLampDriverCloud;
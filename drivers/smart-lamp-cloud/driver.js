'use strict';

const Homey = require('homey');
const CloudApi = require('../cloud.js');

class SmartLampDriverCloud extends Homey.Driver {

	onInit() {
		this.log('SmartLampDriverCloud has been inited');

		this._devices = {};

		this.homey.flow.getActionCard('set_scene_cloud')
			.registerRunListener(({ device, scene }) => {
				return device.setScene(scene);
			})
			.registerArgumentAutocompleteListener('scene', async (query, { device }) => {
				const scenes = await device.getScenesNames();
				return scenes.filter(scene => {
					return scene.name.toLowerCase().indexOf(query.toLowerCase()) > -1;
				});
			});
	}

	async onPair (session) {
		this.log('onPair');

		this.token = null;

		session.setHandler('token', async (data) => {
			this.token = data.token;
			return;
		});

		session.setHandler('list_devices', async (data) => {
			let foundDevices = [];

			if (!this.onPairListDevices)
				this.error((new Error('missing onPairListDevices')));

			foundDevices = await this.onPairListDevices(this.token);

			return foundDevices;
		});
	}

	async onPairListDevices( token ) {
		this.log('onPairListDevices', token);

		const cloudApi = new CloudApi();
		let foundDevices = [];

		await new Promise((resolve, reject) => {
			cloudApi.Discover(token, async (error, discovered_devices) => {
				if (error || !Array.isArray(discovered_devices))
					return resolve(false);

				await Promise.all(discovered_devices.map(async (device) => {
					foundDevices.push({
						name: device.name,
						data: {
							id: device.id,
							api: device.api_version,
							key: token
						}
					});
				}));

				return resolve(true);
			});
		});

		return foundDevices;
	}

}

module.exports = SmartLampDriverCloud;
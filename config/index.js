'use strict';

const uuids = {
	SERVICE_UUID: '44092840-0567-11E6-B862-0002A5D5C51B',
	API_CHARACTERISTIC_UUID: '44092842-0567-11E6-B862-0002A5D5C51B'
}

// convert uuids to homey uuids
for( let key in uuids ) {
	uuids[key] = uuids[key].toLowerCase().replace(/-/g, '');
}

module.exports = uuids;
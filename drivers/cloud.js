'use strict';

let https = require('https');

function https_get(path, key, payload, callback) {
    let method = payload ? 'PUT' : 'GET';

    let request = https.request({
        hostname: 'cloud.luke-roberts.com',
        port: 443,
        path: '/api/v1' + path,
        method: method,
        headers: {
        	'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
        }
    }, (response) => {
        var data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            var json = {};
            var error = null;

            if (method === 'PUT') {
                if (response.statusCode !== 204)
                    error = 'invalid response';
            } else {
                try {
                    json = JSON.parse(data);
                } catch (e) {
                    error = e;
                }
            }

            callback(error, json);
        });

        response.on('error', (error) => {
            callback(error);
        });
    });

    request.setTimeout(2500, () => {
        request.abort();
    });

    request.on('error', (error) => {
        callback(error);
    });

    if (method === 'PUT') {
        request.write(JSON.stringify(payload));
    }

    request.end();
}

CloudApi.prototype.Command = function (key, id, payload, callback) {
    https_get('/lamps/' + id + '/command', key, payload, (error, response) => {
        if (error) {
            console.log(error);
            return callback(error, null);
        }

        callback(null, response);
    });
};


CloudApi.prototype.Discover = function (key, callback) {
    https_get('/lamps', key, null, (error, response) => {
        if (error) {
            console.log(error);
            return callback(error, null);
        }

        callback(null, response);
    });
};

function CloudApi() {
}

module.exports = CloudApi;

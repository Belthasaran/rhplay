/**
 * SNES Contents Manager
 * 
 * Manages cache of files on SNES device in clientdata.db
 * Syncs after uploads and provides quick launch functionality
 */


class HostFP {
  constructor() {
  }

  getv() {
	  //     "hddserial" : "^0.0.7",
          //    "node-machine-id": "^1.1.12",
	  //
	  const crypto = require('crypto');
          const hash = crypto.createHash('sha1');

	  var hddserial = require('hddserial');
	  var hddfp;

          hddserial.one(0,function (err, serial) {
              if (serial == null) {
		  hddfp = "0000000000000000"
	      } else {
                  hash.update(serial)
		  hddfp = hash.digest('hex').substr(0,24)
	      }

	      const machid = require('node-machine-id');
              let id = machid.machineIdSync(true);
              const hash2 = crypto.createHash('sha1');
              hash2.update(id);

	      var idhash = hash2.digest('hex').substr(0,24)
	      console.log("%s:%s", idhash, hddfp);
          });

  }

}

module.exports = { HostFP };


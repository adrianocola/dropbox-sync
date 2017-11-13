const fs = require('fs');
const dch = require('./dropbox-content-hasher');

module.exports = (file, cb) => {
    const hasher = dch.create();
    const f = fs.createReadStream(file);
    f.on('data', function(buf) {
        hasher.update(buf);
    });
    f.on('end', function(err) {
        cb(err, hasher.digest('hex'));
    });
    f.on('error', cb);
};
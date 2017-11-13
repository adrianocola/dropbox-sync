const secret = require('./secret.json');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const async = require('async');
const watch = require('node-watch');
const Dropbox = require('dropbox');
const DropboxHasher = require('./dropbox-hasher');
const dbx = new Dropbox({ accessToken: secret.DROPBOX_KEY });

const fullPath = secret.SYNC_FULL_PATH.endsWith('/') ? secret.SYNC_FULL_PATH : secret.SYNC_FULL_PATH + '/';

const getRemoteFilesList = (cb) => {
    let entries = [];

    const get = (cursor) => {
        let method = 'filesListFolder';
        let opts = {path: ''};
        if(cursor){
            method = 'filesListFolderContinue';
            opts = {cursor};
        }
        dbx[method](opts)
            .then(function(response) {
                entries = entries.concat(response.entries);
                if(response.has_more){
                    get(response.cursor);
                }else{
                    cb(null, entries);
                }
            })
            .catch(cb);
    };
    get();
};

const getLocalFilesList = (cb) => {
    fs.readdir(fullPath, (err, data) => {
        if(err) return cb(err);
        async.map(data, (name, cb) => {
            fs.stat(fullPath + name, (err, data) => {
                if(err) return cb(err);
                cb(null, {name: name, size: data.size, modified: data.mtime});
            });
        }, cb);

    });
};

const updateFile = (name, cb) => {
    fs.readFile(fullPath + name, (err, data) => {
        if (err) return cb(err);
        dbx.filesUpload({path: '/' + name, contents: data})
            .then(function(response) {
                console.log(`Dropbox updated ${name}`);
                cb();
            })
            .catch(cb);
    });
};

const deleteFile = (name, cb) => {
    dbx.filesDelete({path: '/' + name})
        .then(function(response) {
            console.log(`Dropbox removed ${name}`);
            cb();
        })
        .catch(cb);
};

const fullSync = (cb) => {
    console.log('Full sync started');
    async.series([getRemoteFilesList, getLocalFilesList], (err, results) => {
        if(err) return console.error(err);
        const serverFiles = results[0];
        const localFiles = results[1];

        const serverMap = _.keyBy(serverFiles, 'name');
        const localMap = _.keyBy(localFiles, 'name');

        async.series([(cb) => {
            async.eachOf(localMap, (localFile, name, cb) => {
                if(name === '.DS_Store') return cb();
                const serverFile = serverMap[name];
                if(!serverFile){
                    updateFile(name, cb);
                }else{
                    serverFile.checked = true;
                    DropboxHasher(fullPath + name, (err, hash) => {
                        if (err) cb(err);
                        if(serverFile.content_hash !== hash){
                            updateFile(name, cb);
                        }else{
                            cb();
                        }
                    });
                }
            }, cb);
        }, (cb) => {
            async.eachOf(serverMap, (serverFile, name, cb) => {
                if(!serverFile.checked) {
                    deleteFile(name, cb);
                }else{
                    cb();
                }
            }, cb);
        }], (err) => {
            console.log('Full sync finished');
            cb(err);
        });
    });
};


fullSync(() => {
    console.log('Watching for changes in: ' + fullPath);

    const onError = (err) => {
        if(err) console.error(err);
    };

    watch(secret.SYNC_FULL_PATH, (eventType, filename) => {
        const name = path.basename(filename);
        if(name === '.DS_Store') return;

        if(eventType === 'update'){
            updateFile(name, onError);
        }else if(eventType === 'remove'){
            deleteFile(name, onError);
        }
    });
});






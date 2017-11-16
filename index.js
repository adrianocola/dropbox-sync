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
    const results = [];
    fs.readdir(fullPath, (err, data) => {
        if(err) return cb(err);
        async.each(data, (name, cb) => {
            fs.stat(fullPath + name, (err, stats) => {
                if(err) return cb(err);
                if(stats.isFile() && name !== '.DS_Store'){
                    results.push(name);
                }
                cb();
            });
        }, (err) => {
            cb(err, results);
        });
    });
};

const updateFile = (name, cb) => {
    fs.readFile(fullPath + name, (err, data) => {
        if (err) return cb(err);
        console.log('UPDATING: ' + name);
        dbx.filesUpload({path: '/' + name, contents: data, mode: {'.tag': 'overwrite'}})
            .then(function(response) {
                console.log(`Dropbox updated ${name}`);
                cb();
            })
            .catch((err) => {
                console.log(`Dropbox updated error for file ${name}:`);
                console.log(err);
                cb(err);
            });
    });
};

const deleteFile = (name, cb) => {
    console.log('REMOVING: ' + name);
    dbx.filesDelete({path: '/' + name})
        .then(function(response) {
            console.log(`Dropbox removed ${name}`);
            cb();
        })
        .catch((err) => {
            console.log(`Dropbox removed error for file ${name}:`);
            console.log(err);
            cb(err);
        });
};

const fullSync = (cb) => {
    cb = cb || function(){};
    console.log('Full sync started');
    async.series([getRemoteFilesList, getLocalFilesList], (err, results) => {
        if(err) return console.error(err);
        const serverFiles = results[0];
        const localFiles = results[1];

        const serverMap = _.keyBy(serverFiles, 'name');

        async.series([(cb) => {
            async.eachSeries(localFiles, (name, cb) => {
                const serverFile = serverMap[name];
                if(!serverFile){
                    updateFile(name, cb);
                }else{
                    serverFile.checked = true;
                    DropboxHasher(fullPath + name, (err, hash) => {
                        if (err) return cb(err);
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
            if(err){
                console.log('Full sync finished with errors');
            }else{
                console.log('Full sync finished');
            }
            cb(err);
        });
    });
};

const watchForChanges = () => {
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
};

// if running with "node index.js --watch", also watch directory for changes
async.series([
    fullSync,
    process.argv[2] === '--watch' ? watchForChanges : (cb) => cb(),
]);

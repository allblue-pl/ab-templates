'use strict';

var abLog = require('ab-log');
var abTasks = require('ab-tasks');
var abWatcher = require('ab-watcher');
var chalk = require('chalk');
var fs = require('fs');
var path = require('path');

var _Properties = require('./_Properties');

var _ExtInfo = require('./_ExtInfo');
var _ExtTpl = require('./_ExtTpl');
var _Header = require('./_Header');


var Template = {

    _tplPath: null,
    _abTasks: null,

    _extInfos: null,

    _tplInfo: null,
    _tplInfo_Watcher: null,

    /* ExtTpl Properties */
    _build: null,
    _paths: null,
    _tasks: null,
    _uris: null,
    _header: null,

    Class: function(tpl_path, ext_names)
    {
        /* Testing */
        ext_names = [ 'css', 'header', 'js' ];

        this._tplPath = tpl_path;
        this._abTasks = abTasks.new();

        this._createProperties();

        /* Exts */
        this._extInfos = {};
        this._exts_Create(ext_names);

        /* Tpl Info */
        var self = this;
        this._tplPath = tpl_path;
        this._tplInfo_Watcher = abWatcher.new()
            .on([ 'add', 'change', 'unlink' ], function(file_path) {
                self._tasks_ParseTplInfo().call();
            });
    },

    log: function()
    {
        var args = [];
        for (var i in arguments)
            args.push(chalk.gray(arguments[i]));

        console.log.apply(console, args);
    },

    watch: function()
    {
        this._tplInfo_Watcher.update(this._tplPath);
    },

    _createProperties: function()
    {
        this._build = new _Properties.Build.Class({
            final: false
        });

        this._header = new _Properties.Header.Class();

        this._paths = new _Properties.Paths.Class({
            index: './',
            front: './',
            back: './'
        });

        this._uris = new _Properties.Uris.Class({
            base: '/'
        });
        this._uris._properties_Update({
            index: this._getUri(this._paths.index),
            front: this._getUri(this._paths.front)
        });

        /* Tasks */
        var self = this;
        this._tasks = {
            build: function() {
                return self._tasks_Build.apply(self, arguments);
            },
            buildHeader: function() {
                return self._tasks_BuildHeader.apply(self, arguments);
            },
            clean: function() {
                return self._tasks_Clean.apply(self, arguments);
            },
            parseTplInfo: function() {
                return self._tasks_ParseTplInfo.apply(self, arguments);
            }
        };
    },

    _exts_Create: function(ext_names)
    {
        var self = this;

        ext_names.forEach(function(ext_name) {
            var require_path = ext_name.indexOf('./') === 0 ?
                    ext_name : 'ab-templates-' + ext_name;

            var ext_class = function() {
                if (!('name' in this))
                    this.name = ext_name;
            };
            ext_class.prototype = require(require_path);

            var ext = new ext_class();
            var ext_tpl = new _ExtTpl.Class(self, ext);

            ext.onCreate(ext_tpl);

            var ext_info = new _ExtInfo.Class();
            ext_info.ext = ext;
            ext_info.tpl = ext_tpl;

            self._extInfos[ext_name] = ext_info;
        });
    },

    _getUri: function(fs_path)
    {
        return this._uris.base + path.relative(this._paths.index, fs_path)
                .replace(/\\/g, '/');
    },

    _tasks_Build: function()
    {
        var self = this;
        return this._abTasks.create('build', function() {
            self.log('# Building...');

            for (var ext_name in self._extInfos) {
                if (!('onBuild' in self._extInfos[ext_name].ext))
                    continue;

                self._tasks_Ext_Build(ext_name).call();
            }
                })
            .waitFor('buildHeader')
            .waitFor('ext.*.buildHeader');
    },

    _tasks_BuildHeader: function()
    {
        var self = this;
        return this._abTasks.create('buildHeader', function(tpl_info_array) {
            self.log('# Building header...');

            var tpl_info = tpl_info_array.pop();
            var header = new _Header.Class();
            self._header._header = header;

            for (var ext_name in self._extInfos) {
                if (!('onBuildHeader' in self._extInfos[ext_name].ext))
                    continue;

                self._tasks_Ext_BuildHeader(ext_name).call(header);
            }

            self._tasks_Build().call();
        });
    },

    _tasks_Ext_Build: function(ext_name)
    {
        var self = this;
        return this._abTasks.create('ext.' + ext_name + '.build',
                function(header_array) {
            var ext_info = self._extInfos[ext_name];

            return ext_info.ext.onBuild(ext_info.tpl,
                    header_array.pop().pop());
                    })
                .waitFor('buildHeader');
    },

    _tasks_Ext_BuildHeader: function(ext_name)
    {
        var self = this;
        return this._abTasks.create('ext.' + ext_name + '.buildHeader',
                function(header_array) {
            var ext_info = self._extInfos[ext_name];
            var header = header_array.pop().pop();

            return ext_info.ext.onBuildHeader(ext_info.tpl, header);
                })
            .waitFor('buildHeader');
    },

    _tasks_ParseTplInfo: function(tpl_path)
    {
        var self = this;
        return this._abTasks.create('parseTplInfo', function() {
            return new Promise(function(resolve, reject) {
                fs.readFile(self._tplPath, 'utf8', function (err, data) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    var tpl_info = null;
                    try {
                        tpl_info = JSON.parse(data);
                    } catch (json_err) {
                        reject('Cannot parse `tpl.json`: ' + json_err.stack);
                        return;
                    }

                    /* Read `config` */
                    if ('config' in tpl_info) {
                        if ('paths' in tpl_info.config) {
                            for (var path_name in self._paths) {
                                var config_paths = tpl_info.config.paths;

                                if (path_name in config_paths) {
                                    self._paths._property_Set(path_name,
                                            config_paths[path_name]);
                                }
                            }
                        }
                    }

                    self.log('# Parsed `tpl.json`.');

                    Object.freeze(tpl_info);
                    for (var ext_name in self._extInfos) {
                        var ext_info = self._extInfos[ext_name];
                        if (!('onBuildHeader' in ext_info.ext))
                            continue;

                        ext_info.ext.onTplChanged(ext_info.tpl, tpl_info);
                    }

                    self._tasks_BuildHeader().call(tpl_info);

                    resolve();
                });
            });
        });
    }

};
Template.Class.prototype = Template;
module.exports = Template;

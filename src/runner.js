/*******************************************************************************
 * Copyright (c) 2013 Max Schaefer
 * Copyright (c) 2018 Persper Foundation
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v2.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *******************************************************************************/

const bindings = require('./bindings');
const astutil = require('./astutil');
const pessimistic = require('./pessimistic');
const semioptimistic = require('./semioptimistic');
const callbackCounter = require('./callbackCounter');
const requireJsGraph = require('./requireJsGraph');
const path = require('path');
const fs = require('fs');
const utils = require('./utils');

this.args = null;
this.files = null;
this.consoleOutput = null;

Array.prototype.remove = function () {
    var what, a = arguments, L = a.length, ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};

let addNode = function (edge, v) {
    if (v.type === 'CalleeVertex') {
        let nd = v.call;
        edge.label = astutil.encFuncName(nd.attr.enclosingFunction);
        edge.file = nd.attr.enclosingFile;
        edge.start = {row: nd.loc.start.line, column: nd.loc.start.column};
        edge.end = {row: nd.loc.end.line, column: nd.loc.end.column};
        edge.range = {start: nd.range[0], end: nd.range[1]};
        return edge;
    }
    if (v.type === 'FuncVertex') {
        edge.label = astutil.funcname(v.func);
        edge.file = v.func.attr.enclosingFile;
        edge.start = {row: v.func.loc.start.line, column: v.func.loc.start.column};
        edge.end = {row: v.func.loc.end.line, column: v.func.loc.end.column};
        edge.range = {start: v.func.range[0], end: v.func.range[1]};
        return edge;
    }
    if (v.type === 'NativeVertex') {
        //'Math_log' (Native)
        edge.label = v.name;
        edge.file = "Native";
        edge.start.row = null;
        edge.end.row = null;
        edge.start.column = null;
        edge.end.column = null;
        edge.range = {start: null, end: null};
        return edge;
    }
    throw new Error("strange vertex: " + v);
};

let buildBinding = function (call, fn) {
    let edge = {
        source: {
            label: null,
            file: null,
            start: {row: null, column: null},
            end: {row: null, column: null},
            range: {start: null, end: null}
        },
        target: {
            label: null,
            file: null,
            start: {row: null, column: null},
            end: {row: null, column: null},
            range: {start: null, end: null}
        }
    };
    addNode(edge.source, call);
    addNode(edge.target, fn);
    return edge;
};

let pp = function (v) {
    if (v.type === 'CalleeVertex')
        return '\'' + astutil.encFuncName(v.call.attr.enclosingFunction) + '\' (' + astutil.ppPos(v.call) + ')';
    if (v.type === 'FuncVertex')
        return '\'' + astutil.funcname(v.func) + '\' (' + astutil.ppPos(v.func) + ')';
    if (v.type === 'NativeVertex')
        return '\'' + v.name + '\' (Native)';
    throw new Error("strange vertex: " + v);
};

let build = function () {
    let args = this.args;
    let files = this.files;
    let consoleOutput = this.consoleOutput;

    let filter = this.filter;

    if (filter !== undefined && filter.length > 0) {
        let filteredfiles = [];
        files.forEach(function (file) {
            filteredfiles.push(file);
            filter.forEach(function (elem) {
                let trunk = elem.substr(1).trim();
                let expression = new RegExp(trunk, "gm");
                let result = expression.test(file);

                if (result && elem.startsWith('-')) {
                    filteredfiles.remove(file);
                }

                if (result && elem.startsWith('+')) {
                    filteredfiles.push(file);
                }

            });
        });
        files = Array.from(new Set(filteredfiles));
    }

    args.strategy = args.strategy || 'ONESHOT';
    if (!args.strategy.match(/^(NONE|ONESHOT|DEMAND|FULL)$/)) {
        process.exit(-1);
    }
    if (args.strategy === 'FULL') {
        console.warn('strategy FULL not implemented yet; using DEMAND instead');
        args.strategy = 'DEMAND';
    }
    if (args.time) console.time("parsing  ");
    var ast = astutil.astFromFiles(files);
    if (args.time) console.timeEnd("parsing  ");

    if (args.time) console.time("bindings ");
    bindings.addBindings(ast);
    if (args.time) console.timeEnd("bindings ");

    if (args.time) console.time("callgraph");
    var cg;
    if (args.strategy === 'NONE' || args.strategy === 'ONESHOT')
        cg = pessimistic.buildCallGraph(ast, args.strategy === 'NONE');
    else if (args.strategy === 'DEMAND')
        cg = semioptimistic.buildCallGraph(ast);
    if (args.time) console.timeEnd("callgraph");

    if (args.fg) {
        let serializedGraph = cg.fg.graph.serialize();
        serializedGraph.links.forEach((link) => {
            console.log(link.source, "=>", link.target);
        });
    }

    if (args.countCB)
        callbackCounter.countCallbacks(ast);

    if (args.reqJs)
        requireJsGraph.makeRequireJsGraph(ast).forEach(function (edge) {
            console.log(edge.toString());
        });
    if (args.cg) {
        let result = [];
        cg.edges.iter(function (call, fn) {
            result.push(buildBinding(call, fn));
            if (consoleOutput)
                console.log(pp(call) + " -> " + pp(fn));
        });
        if (this.args.output !== undefined) {
            let filename = this.args.output[0];
            if (!filename.endsWith(".json")) {
                filename += ".json";
            }

            var json_out = "";

            fs.writeFileSync(filename, "[", {flag: 'w+'}); /* Write initial JSON header and create file */

            for (var indx = 0; indx < result.length - 1; indx++) {
                var current = JSON.stringify(result[indx], null, 2) + ",";

                /* Most recent string length limit = 2^29 - 16
                    https://github.com/v8/v8/commit/ea56bf5513d0cbd2a35a9035c5c2996272b8b728 */
                if (json_out.length >= 2 ** 29 - 16 - current.length) {
                    fs.writeFileSync(filename, json_out, {flag: 'a'});
                    json_out = "";
                }

                json_out += current;
            }

            fs.writeFileSync(filename, json_out, {flag: 'a'});

            json_out = JSON.stringify(result[result.length - 1], null, 2) + "]";
            fs.writeFileSync(filename, json_out, {flag: 'a'}); /* Write final JSON bytes */

        }
        return result;
    }
};

exports.setFiles = function (inputList) {
    let filelist = [];
    inputList.forEach(function (file) {
        file = path.resolve(file);
        if (!fs.existsSync(file)) {
            console.warn('The path "' + file + '" does not exists.');
        } else if (fs.statSync(file).isDirectory()) {
            filelist = utils.collectFiles(file, filelist);
        } else if (file.endsWith(".js") || file.endsWith(".ts") || file.endsWith(".vue")) {
            filelist.push(file);
        }
    });
    this.files = Array.from(new Set(filelist));
    if (this.files.length === 0) {
        console.warn("Input file list is empty!");
        process.exit(-1);
    }
};

exports.setFilter = function (filter) {
    this.filter = filter;
};

exports.setArgs = function (args) {
    this.args = args;
};

exports.setConsoleOutput = function (value) {
    this.consoleOutput = value;
};

exports.build = build;

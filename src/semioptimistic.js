/*******************************************************************************
 * Copyright (c) 2013 Max Schaefer
 * Copyright (c) 2018 Persper Foundation
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v2.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *******************************************************************************/

/* Optimistic call graph builder that tries to be clever about
 * which interprocedural flows to propagate: it only propagates
 * along edges that lead to a function call. */

const graph = require('./graph');
const natives = require('./natives');
const flowgraph = require('./flowgraph');
const callgraph = require('./callgraph');
const mod = require('./module');
const dftc = require('./dftc');

function addInterproceduralFlowEdges(ast, fg) {
    fg = fg || new graph.FlowGraph();

    let changed;
    do {
        changed = false;

        const reach = dftc.reachability(fg, function (nd) {
            return nd.type !== 'UnknownVertex';
        });

        ast.attr.calls.forEach(function (call) {
            const res = flowgraph.resVertex(call);
            if (!res.attr.interesting) {
                reach.iterReachable(res, function (nd) {
                    if (nd.type === 'CalleeVertex') {
                        res.attr.interesting = true;
                    }
                });
            }
        });

        ast.attr.functions.forEach(function (fn) {
            let interesting = false;
            const nparams = fn.params.length;

            for (let i = 0; i <= nparams; ++i) {
                const param = flowgraph.parmVertex(fn, i);
                if (!param.attr.interesting) {
                    reach.iterReachable(param, function (nd) {
                        if (nd.type === 'CalleeVertex') {
                            param.attr.interesting = true;
                        }
                    });
                }
                interesting = interesting || param.attr.interesting;
            }

            reach.iterReachable(flowgraph.funcVertex(fn), function (nd) {
                if (nd.type === 'CalleeVertex') {
                    const call = nd.call;
                    const res = flowgraph.resVertex(call);

                    if (res.attr.interesting) {
                        const ret = flowgraph.retVertex(fn);
                        if (!fg.hasEdge(ret, res)) {
                            changed = true;
                            fg.addEdge(ret, res);
                        }
                    }

                    if (interesting) {
                        for (let i = 0; i <= nparams; ++i) {
                            if (i > call.arguments.length) {
                                break;
                            }

                            const param = flowgraph.parmVertex(fn, i);
                            if (param.attr.interesting) {
                                const arg = flowgraph.argVertex(call, i);
                                if (!fg.hasEdge(arg, param)) {
                                    changed = true;
                                    fg.addEdge(arg, param);
                                }
                            }
                        }
                    }
                }
            });
        });
    } while (changed); // until fixpoint

    return fg;
}

function buildCallGraph(ast) {
    const fg = new graph.FlowGraph();
    natives.addNativeFlowEdges(fg);
    flowgraph.addIntraproceduralFlowGraphEdges(ast, fg);

    const expFuncs = {};
    const impFuncs = {};
    mod.collectExportsImports(ast, expFuncs, impFuncs);
    mod.connectImports(fg, expFuncs, impFuncs);

    addInterproceduralFlowEdges(ast, fg);
    return callgraph.extractCG(ast, fg);
}

exports.addInterproceduralFlowEdges = addInterproceduralFlowEdges;
exports.buildCallGraph = buildCallGraph;

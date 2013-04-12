var Path = require('path'),
    crypto = require('crypto'),
    fs = require('fs'),
    _ = require('underscore'),
    less = require('less'),
    seq = require('seq'),
    flattenLessText = require('./flattenLessText');

require('express-hijackresponse');
require('bufferjs');

module.exports = function compiless(options) {
    if (!options || !options.root) {
        throw new Error('options.root is mandatory');
    }
    return function (req, res, next) {
        if (req.accepts('text/css')) {
            // Prevent If-None-Match revalidation with the downstream middleware with ETags that aren't suffixed with "-compiless":
            var ifNoneMatch = req.headers['if-none-match'];
            if (ifNoneMatch) {
                var validIfNoneMatchTokens = ifNoneMatch.split(" ").filter(function (etag) {
                    return /-compiless\"$/.test(etag);
                });
                if (validIfNoneMatchTokens.length > 0) {
                    req.headers['if-none-match'] = validIfNoneMatchTokens.join(" ");
                } else {
                    delete req.headers['if-none-match'];
                }
            }
            delete req.headers['if-modified-since']; // Prevent false positive conditional GETs after enabling compiless
            res.hijack(function (err, res) {
                var contentType = res.getHeader('Content-Type'),
                    matchContentType = contentType && contentType.match(/^text\/less(?:;\s*charset=([a-z0-9\-]+))?$/i);
                // The mime module doesn't support less yet, so we fall back:
                if (matchContentType || (/\.less(?:\?.*)?$/.test(req.url) && contentType === 'application/octet-stream')) {
                    function sendErrorResponse(errorMessage, cssText) {
                        errorMessage = "express-compiless: Error compiling " + req.originalUrl + ":\n" + errorMessage;
                        res.removeHeader('Content-Length');
                        res.setHeader('Content-Type', 'text/css');
                        res.send("body:before {display: block; z-index: 999999; white-space: pre; font-family: 'Courier New', monospace; font-size: 24px; color: black; margin: 10px; padding: 10px; border: 4px dashed red; margin-bottom: 10px; content: '" + errorMessage.replace(/'/g, "\\'").replace(/\n/g, '\\00000a') + "'}\n" + (cssText || ''));
                    }

                    var chunks = [];
                    res.on('error', function () {
                        res.unhijack();
                        next();
                    }).on('data', function (chunk) {
                        chunks.push(chunk);
                    }).on('end', function () {
                        if (!chunks.length) {
                            return res.send(res.statusCode);
                        }
                        var lessText = Buffer.concat(chunks).toString('utf-8'), // No other charsets are really relevant, right?
                            baseDir = Path.resolve(options.root, req.url.replace(/\/[^\/]*(?:\?.*)?$/, '/').substr(1)),
                            isSeenByFileName = {},
                            errors = [];

                        flattenLessText(lessText, baseDir, baseDir, isSeenByFileName, errors, function (err, flattenedLessText) {
                            if (err) {
                                errors.push(err);
                            }

                            seq(Object.keys(isSeenByFileName))
                                .parEach(function (fileName) {
                                    fs.stat(fileName, this.into(fileName));
                                })
                                .unflatten()
                                .seq(function (fileNames) {
                                    var oldETag = res.getHeader('ETag');
                                    if (oldETag) {
                                        var etagFragments = [oldETag.replace(/^"|"$/g, '')];
                                        if (fileNames.length) {
                                            var importedFileStats = [];
                                            fileNames.sort().forEach(function (fileName) {
                                                var stats = this.vars[fileName];
                                                importedFileStats.push(fileName, String(stats.mtime.getTime()), String(stats.size));
                                            }, this);
                                            etagFragments.push(crypto.createHash('md5').update(importedFileStats.join('-')).digest('hex').substr(0, 16));
                                        }
                                        var newETag = '"' + etagFragments.join('-') + '-compiless"';
                                        res.setHeader('ETag', newETag);

                                        if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
                                            return res.send(304);
                                        }
                                    }

                                    // Unfortunately less.render throws errors in async code instead of passing it to our callback.
                                    // Hopefully the solution for https://github.com/cloudhead/less.js/issues/462 will remedy this.
                                    less.render(flattenedLessText, {paths: [baseDir]}, function (err, cssText) {
                                        if (err) {
                                            errors.push(err);
                                        }
                                        if (errors.length) {
                                            return sendErrorResponse(_.pluck(errors, 'message').join("\n"), cssText);
                                        }
                                        cssText = fileNames.map(function (fileName) {
                                            return ".compilessinclude {background-image: url(" + Path.relative(baseDir, fileName) + "); display: none;}\n";
                                        }).join("") + cssText;
                                        res.setHeader('Content-Type', 'text/css');
                                        res.setHeader('Content-Length', Buffer.byteLength(cssText));
                                        res.end(cssText);
                                    });
                               });
                        });
                    });
                } else {
                    res.unhijack(true);
                }
            });
            next();
        } else {
            next();
        }
    };
};

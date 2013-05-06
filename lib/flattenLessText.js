var Path = require('path'),
    fs = require('fs'),
    seq = require('seq'),
    passError = require('passerror'),
    urlTokenRegExp = /url\((['"]|)(.*?)\1\)/g,
    importRegExp = /(@import(?:\s*'.*?'|\s*".*?"|\s+url\((?:[^'"]*?|'[^']*'|"[^"]*")\));)/,
    importRegExpWithCaptures = /@import(?:\s*(['"])(.*?)\1|\s+url\((['"]|)(.*?)\3\));/;

// Returns flattened less text, accumulates seen files in the isSeenByFileName object provided by the caller.
module.exports = function flattenLessText(lessText, flattenedLessTextDir, baseDir, isSeenByFileName, errors, cb) {
    lessText = lessText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, ''); // Remove comments
    seq(lessText.split(importRegExp))
        .parMap(function (chunk) {
            var cb = this,
                matchImport = chunk.match(importRegExpWithCaptures);
            if (matchImport) {
                var importedFileName = Path.resolve(baseDir.replace(/\/*$/, '/'), matchImport[2] || matchImport[4]),
                    importedFileDir = Path.dirname(importedFileName);
                fs.readFile(importedFileName, 'utf-8', function (err, importedLessText) {
                    if (err) {
                        errors.push(err);
                        cb(null, '');
                    } else {
                        isSeenByFileName[importedFileName] = true;
                        flattenLessText(importedLessText, flattenedLessTextDir, importedFileDir, isSeenByFileName, errors, passError(cb, function (lessText) {
                            lessText = lessText.replace(urlTokenRegExp, function ($0, quoteChar, href) {
                                if (/^\w+:/.test(href) || /^\//.test(href)) {
                                    // Skip absolute, protocol-relative, and root-relative urls
                                    return $0;
                                } else {
                                    // Make the href relative to the directory of the flattened file:
                                    var referencedFileName = Path.resolve(importedFileDir, href),
                                        rewrittenHref = Path.relative(flattenedLessTextDir + '/', referencedFileName);

                                    // Quote if necessary:
                                    if (/^[a-z0-9\/\-_.]*$/i.test(rewrittenHref)) {
                                        return "url(" + rewrittenHref + ")";
                                    } else {
                                        return "url('" + rewrittenHref.replace(/([\'\"])/g, "\\$1") + "')";
                                    }
                                }
                            });
                            cb(null, lessText);
                        }));
                    }
                });
            } else {
                cb(null, chunk);
            }
        })
        .catch(function (err) {
            // Why doesn't this work?!
            cb(err);
        })
        .seq(function () {
            cb(null, this.stack.join(''));
        });
}

var Path = require('path'),
    fs = require('fs'),
    seq = require('seq'),
    passError = require('passerror'),
    importRegExp = /(@import(?:\s*'.*?'|\s*".*?"|\s+url\((?:[^'"]*?|'[^']*'|"[^"]*")\));)/,
    importRegExpWithCaptures = /@import(?:\s*(['"])(.*?)\1|\s+url\((['"]|)(.*?)\3\));/;

// Returns flattened less text, accumulates seen files in the isSeenByFileName object provided by the caller.
module.exports = function flattenLessText(lessText, baseDir, isSeenByFileName, errors, cb) {
    lessText = lessText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/, ''); // Remove comments
    seq(lessText.split(importRegExp))
        .parMap(function (chunk) {
            var cb = this,
                matchImport = chunk.match(importRegExpWithCaptures);
            if (matchImport) {
                var importedFileName = Path.resolve(baseDir.replace(/\/*$/, '/'), matchImport[2] || matchImport[4]);
                fs.readFile(importedFileName, 'utf-8', function (err, importedLessText) {
                    if (err) {
                        errors.push(err);
                        cb(null, '');
                    } else {
                        isSeenByFileName[importedFileName] = true;
                        flattenLessText(importedLessText, Path.dirname(importedFileName), isSeenByFileName, errors, passError(cb, function (lessText) {
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

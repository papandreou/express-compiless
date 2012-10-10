var Path = require('path'),
    fs = require('fs'),
    seq = require('seq'),
    passError = require('passerror'),
    importRegExp = /(@import(?:\s*'.*?'|\s*".*?"|\s+url\((?:[^'"]*?|'[^']*'|"[^"]*")\));)/,
    importRegExpWithCaptures = /@import(?:\s*(['"])(.*?)\1|\s+url\((['"]|)(.*?)\3\));/;

// Returns flattened less text, accumulates seen files in the isSeenByFileName object provided by the caller.
module.exports = function flattenLessText(lessText, baseDir, isSeenByFileName, cb) {
    lessText = lessText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/, ''); // Remove comments
    seq(lessText.split(importRegExp))
        .parMap(function (chunk) {
            var cb = this,
                matchImport = chunk.match(importRegExpWithCaptures);
            if (matchImport) {
                var importedFileName = Path.resolve(baseDir.replace(/\/*$/, '/'), matchImport[2] || matchImport[4]);
                isSeenByFileName[importedFileName] = true;
                fs.readFile(importedFileName, 'utf-8', passError(cb, function (importedLessText) {
                    flattenLessText(importedLessText, Path.dirname(importedFileName), isSeenByFileName, passError(cb, function (lessText) {
                        cb(null, lessText);
                    }));
                }));
            } else {
                this(null, chunk);
            }
        })
        .seq(function () {
            cb(null, this.stack.join(''));
        });
}

var express = require('express'),
    Path = require('path'),
    request = require('request'),
    passError = require('passerror'),
    expect = require('expect.js'),
    fs = require('fs'),
    flattenLessText = require('../lib/flattenLessText');

describe('flattenLessText', function () {
    it('should rewrite urls correctly', function (done) {
        var baseDir = Path.resolve(__dirname, 'root'),
            lessText = fs.readFileSync(Path.resolve(baseDir, 'importLessWithRelativeImageReferenceInDifferentDir.less'), 'utf-8');

        flattenLessText(lessText, baseDir, baseDir, {}, [], passError(done, function (flattenedLessText) {
            expect(flattenedLessText).to.match(/url\(imports\/images\/foo.png\)/);
            done();
        }));
    });
});

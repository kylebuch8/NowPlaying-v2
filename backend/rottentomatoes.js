'use strict';

var http = require('http');
var youtube = require('./youtube.js');
var Q = require('q');
var nowPlayingMovies = [];
var openingMovies = [];
var rottenTomatoesApiKey = 'qdcwaccyw2tbd5yyk27mdfw2';


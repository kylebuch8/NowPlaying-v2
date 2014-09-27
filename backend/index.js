'use strict';

var http = require('http');
var Hapi = require('hapi');
var MongoClient = require('mongodb').MongoClient;
var MongoServer = require('mongodb').Server;
var mongoClient = new MongoClient(new MongoServer('localhost', 27017));
var db;
var schedule = require('node-schedule');
var scheduleRule = new schedule.RecurrenceRule();
var server = new Hapi.Server('localhost', 8000);
var youtube = require('./youtube.js');
var Q = require('q');
var nowPlayingMovies = [];
var openingMovies = [];
var rottenTomatoesApiKey = 'qdcwaccyw2tbd5yyk27mdfw2';

function updateMoviePosters(movie) {
    movie.posters.detailed = movie.posters.detailed.replace('_tmb', '_det');
    movie.posters.original = movie.posters.original.replace('_tmb', '_ori');
    movie.posters.profile = movie.posters.profile.replace('_tmb', '_pro');
    return movie;
}

function setYoutubeTrailerId(movie) {
    var deferred = Q.defer();
    
    youtube.getYoutubeTrailerId(movie.title)
        .then(function (youtubeId) {
            movie.youtubeId = youtubeId;
            deferred.resolve(movie);
        }, function (err) {
            deferred.reject(err);
        });
    
    return deferred.promise;
}

function setNowPlayingCache(orderArr, savedMovies) {
    var cache = [];
    
    orderArr.forEach(function (movieId) {
        var i = 0,
            length = orderArr.length;
        
        for (i; i < length; i += 1) {
            if (!savedMovies[i]) {
                continue;   
            }
            
            console.log('Movie Id: ' + movieId);
            console.log('Saved Movie Id: ' + savedMovies[i].id);
            
            if (movieId === savedMovies[i].id) {
                cache.push(savedMovies[i]);
            }
        }
    });
    
    return cache;
}

function saveMovies(movies) {
    var deferred = Q.defer(),
        numMovies = movies.length,
        orderArr = [],
        cachedMovies = [];
    
    if (!numMovies) {
        console.log('error getting movies');
        return;
    }
    
    db.collection('movies', function (err, collection) {
        movies.forEach(function (movie, index) {
            // set the order array
            orderArr.push(movie.id);
            
            // update the movie poster urls
            movie = updateMoviePosters(movie);
            
            /*
             * get the youtube trailer id and then upsert
             * the movie into the db
             */
            setYoutubeTrailerId(movie)
                .then(function (movie) {
                    console.log('movie trailer found: ' + movie.youtubeId);
                }, function () {
                    console.log('error with movie trailer');
                })
                .done(function () {
                    collection.update(
                        {
                            id: movie.id
                        },
                        movie,
                        {
                            w: 0,
                            upsert: true
                        },
                        function (err, result) {
                            if (err) {
                                console.log('update error: ' + err);
                                return;
                            }
                            
                            cachedMovies.push(movie);

                            /*
                             * if this is the last movie in the array from
                             * rotten tomatoes, save this to an array that
                             * we can use instead of calling the database
                             * again
                             */
                            if (index === numMovies - 1) {
                                console.log('done upserting movies');
                                
                                deferred.resolve(setNowPlayingCache(orderArr, cachedMovies));
                            }
                        }
                    );
                });
        });
    });
    
    return deferred.promise;
}

/*
 * get the now playing movies from rotten tomatoes
 */
function fetchNowPlayingMoviesFromRottenTomatoes() {
    console.log('fetching now playing movies from rotten tomatoes');
    
    http.get('http://api.rottentomatoes.com/api/public/v1.0/lists/movies/in_theaters.json?apikey=' + rottenTomatoesApiKey, function (res) {
        var data = '';

        res.on('data', function (chunk) {
            data += chunk;
        });

        res.on('end', function () {
            data = JSON.parse(data);
            saveMovies(data.movies).then(function (movies) {
                nowPlayingMovies = movies
            });
        });
    });
}

/*
 * get the opening movies from rotten tomatoes
 */
function fetchOpeningMoviesFromRottenTomatoes() {
    console.log('fetching opening movies from rotten tomatoes');
    
    http.get('http://api.rottentomatoes.com/api/public/v1.0/lists/movies/opening.json?apikey=' + rottenTomatoesApiKey, function (res) {
        var data = '';
        
        res.on('data', function (chunk) {
            data += chunk;
        });
        
        res.on('end', function () {
            data = JSON.parse(data);
            saveMovies(data.movies).then(function (movies) {
                openingMovies = movies;
            });
        });
    });
}

/*
 * open a connection to the database
 */
mongoClient.open(function (err, mongoClient) {
    db = mongoClient.db('nowplaying');
});

/*
 * set up a schedule for fetching movies from rotten
 * tomatoes every hour
 */
//scheduleRule.minute = 0;
//schedule.scheduleJob(scheduleRule, fetchNowPlayingMoviesFromRottenTomatoes);

setInterval(function () {
    fetchNowPlayingMoviesFromRottenTomatoes();
    fetchOpeningMoviesFromRottenTomatoes();
}, 300000);

/*
 * set up the server and start it
 */
server.route({
    method: 'GET',
    path: '/hello',
    handler: function (request, reply) {
        reply('hello world');
    }
});

server.route({
    method: 'GET',
    path: '/movies',
    handler: function (request, reply) {
        reply(nowPlayingMovies);
    }
});

server.route({
    method: 'GET',
    path: '/opening',
    handler: function (request, reply) {
        reply(openingMovies);
    }
});

server.start();

/*
 * on startup, get the movies from rotten tomatoes.
 * we'll then get the movies every hour on the hour.
 */
fetchNowPlayingMoviesFromRottenTomatoes();
fetchOpeningMoviesFromRottenTomatoes();
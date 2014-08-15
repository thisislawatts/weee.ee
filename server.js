'user strict';

//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');
var path      = require('path');
var spawn = require('child_process').spawn;
var pageres = require('pageres');
var request = require('request');
var easyimage = require('easyimage');
var sizeof = require('image-size');
var urlvalid = require('url-valid');

/**
 *  Define the sample application.
 */
var ScreenshotsApp = function() {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.datadir   = process.env.OPENSHIFT_DATA_DIR || __dirname + "/tmp/";
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        };
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = { 'index.html': '' };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./views/index.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        self.routes['/asciimo'] = function(req, res) {
            var link = "http://i.imgur.com/kmbjB.png";
            res.send("<html><body><img src='" + link + "'></body></html>");
        };

        self.routes['/'] = function(req, res) {
            console.log(req.query);

            if (!req.query['url']) {
                res.setHeader('Content-Type', 'text/html');
                res.send(self.cache_get('index.html') );
            } else {
                self.getThumbnail(req, res);
            }
        };
    };

    self.getThumbnail = function(req, res) {

        var sizes = [1024,576],
            url = req.query.url,
            filename = self._filename( url, sizes ),
            pr;

        console.log("Checking for:", self.datadir + filename );

        fs.exists( self.datadir + filename , function( exists ) {
            if (exists) {
                console.log("File Exists: ", filename);
                res.setHeader('Content-Type', 'image/png');
                res.send( fs.readFileSync( self.datadir + filename) );

            } else {
                console.log("File does not exist: ", self.datadir + filename );
                pr = new pageres({delay: 2})
                    .src( url, [ sizes.join('x') ] )
                    .dest( self.datadir );

                pr.run(function(err, items) {

                    if (err) {
                        console.log("Failed to generate");
                        throw err;
                    }

                    var imagepath = self.datadir + items[0].filename; 
                    var info = sizeof(imagepath)

                    console.log("Generated:", info );

                    console.log("Target height:", (info.height/info.width) * 380);

                    easyimage.rescrop({
                        src: imagepath,
                        dst: imagepath,
                        width: 380,
                        height: (info.height/info.width) * 380,
                        cropwidth: 380,
                        cropheight: 213,
                        gravity: 'NorthWest'
                    }).then(function(image) {

                        console.log("Image Resized: ", image);
                        res.setHeader('Content-Type', 'image/png');
                        res.setHeader('Content-Disposition', 'inline; filename=' + items[0].filename );

                        res.send( fs.readFileSync( imagepath ) );

                    }, function(err) {
                        
                        console.log("Resize failed sending original capture. Error:", err);
                        res.setHeader('Content-Type', 'image/png');
                        res.setHeader('Content-Disposition', 'inline; filename=' + items[0].filename );
                        res.send( fs.readFileSync( imagepath ) );
                    });

                    //request(items.pop()  .filename).pipe(res);
                });

            }
        });
    }


    self._filename = function(url, sizes) {
        return url + "-" + sizes.join("x") + ".png";
    }


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.createRoutes();
        self.app = express();

        self.app.use(function(req, res, next) {

            var testUrl = req.url.substr(1);
            
            urlvalid( testUrl, function(err, valid) {
                
                if (!valid) {
                    next()
                } else {
                    req.query.url = testUrl;
                    self.getThumbnail(req, res);
                }

            })
        })


        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }

    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };
};   /*  Sample Application.  */





/**
 *  main():  Main code.
 */
var zapp = new ScreenshotsApp();
zapp.initialize();
zapp.start();


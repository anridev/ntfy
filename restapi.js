#!/usr/bin/env node

var core		  = require('./core.js');
var express 	  = require('express');
var bodyParser    = require('body-parser');
var formidable 	  = require('formidable');
var util 		  = require('util');
var app 		  = express();
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json());

/*-----------Logging -----------*/
var log4js     	 = require('log4js');
log4js.configure('cfg/log4js.cfg', { reloadSecs: 300 });
var logger       = log4js.getLogger('restapi');
/*-----------End Logging -----------*/

/*---------- CORS middleware ------------------*/
var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', "*");
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
}
app.use(allowCrossDomain);
/*---------- End CORS middleware ------------------*/

/*------------ do the trick so that standard param() understand regexp ---*/
app.param(function(name, fn){
  if (fn instanceof RegExp) {
    return function(req, res, next, val){
      var captures;
      if (captures = fn.exec(String(val))) {
        req.params[name] = captures;
        next();
      } else {
        next('route');
      }
    }
  }
});
/*------------------------ end of trick ------*/
/* ------------------------ params() ---------*/
app.param('user_id', /^\d+$/);
app.param('string', /^\w+$/);
app.param('company_id', /^\d+$/);
app.param('service_id', /^\d+$/);
app.param('update__id', /^\d+$/);
/* ------------------------ end of params() ---------*/

function sendResponse(err, data_object, client){
	if(!err){
		var bodyobj = {
			result		: "ok", 
		};
		for(data_key in data_object){
			bodyobj[data_key] = data_object[data_key];
		}
	} else {
		var bodyobj = {
			result			: "error", 
			description 	: err
		};	
	}
	client.send(JSON.stringify(bodyobj));
}
function sendResponseSearch(err, result_string, client){
	if(!err){
		client.send(result_string);
	} else {
		var bodyobj = {
			result			: "error", 
			description 	: err
		};	
		client.send(JSON.stringify(bodyobj));
	}
	
}
function uploadFile(req, callback){
	var form = new formidable.IncomingForm();
	form.uploadDir = "./files";
	form.keepExtensions = true;
	form.multiples = true;
	form
		.on('error', function(err){
			callback(err);
		})
        .on('aborted', function(err) {
            console.log("user aborted upload");
        })
		.on('progress', function (bytesReceived, bytesExpected){
	        var percent = (bytesReceived / bytesExpected * 100) | 0;
	        console.log('Uploading: %' + percent + '\r');
		})
		.on('end', function(){
			console.log('Upload Finished');
		});
	form.parse(req, function(err, fields, files) {
		var filenames = [];
		files.file.forEach(function(file, index, arr){
			filenames.push(file.path);
			if(index == (arr.length-1)) callback (null, filenames);
		});
    });
}
var null_details = {
	details : null
}

app.post('/api/company', function (req, res){
	logger.debug('Incoming request: ', req.body);
	core.commands.addCompany(req.body.name, req.body.description, req.body.city, req.body.country, function (err, obj){
		sendResponse(err, obj, res);
	});
});
app.get('/api/company/:company_id/service', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.getCompanyServices(req.params.company_id, function (err, obj){
		sendResponse(err, obj, res);
	});
});
app.get('/api/company/:company_id', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.getCompanyProfile(req.params.company_id, function (err, obj){
		sendResponse(err, obj, res);
	});
});
app.post('/api/service', function (req, res){
	logger.debug('Incoming request: ', req.body);
	core.commands.authorizeCompany(req.body.company_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.addService(req.body.name, req.body.description, req.body.company_id, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});

});
app.get('/api/service/:service_id', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.getService(req.params.service_id, function (err, obj){
		sendResponse(err, obj, res);
	});
});
app.delete('/api/service/:service_id', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.getServiceOwner(req.params.service_id, function (err, owner){
		if(!err){
			core.commands.authorizeCompany(owner, req.headers.authorization, function (err, auth){
				if(!err){
					if(auth == 1){
						core.commands.removeService(req.params.service_id, function (err, obj){
							sendResponse(err, obj, res);
						});
					} else sendResponse('Unauthorized', null, res);
				} else sendResponse(err, null, res);
			});
		} else sendResponse(err, null, res);
	});
});
app.post('/api/service/:service_id/update', function (req, res){
	logger.debug('Incoming request: ', req.body);
	core.commands.authorizeCompany(req.body.company_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.addUpdate(req.params.service_id, req.body.update_body, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});

});
app.get('/api/service/:service_id/update', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.getServiceUpdates(req.params.service_id, function (err, obj){
		sendResponse(err, obj, res);
	});
});
app.delete('/api/update/:update_id', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.getUpdateOwner(req.params.update_id, function (err, owner){
		if(!err){
			core.commands.authorizeCompany(owner, req.headers.authorization, function (err, auth){
				if(!err){
					if(auth == 1){
						core.commands.removeUpdate(req.params.update_id, function (err, r){
							sendResponse(err, null_details, res);
						});
					} else sendResponse('Unauthorized', null, res);
				} else sendResponse(err, null, res);
			});
		} else sendResponse(err, null, res);
	});

});
app.post('/api/user', function (req, res){
	logger.debug('Incoming request: ', req.body);
	core.commands.addUser(req.body.client_id, req.body.client_description, req.body.name, req.body.description, function (err, obj){
		sendResponse(err, obj, res);
	});
});
app.get('/api/user/:user_id', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.authorizeUser(req.params.user_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.getUserProfile(req.params.user_id, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});

});
app.post('/api/user/:user_id/subscribe', function (req, res){
	logger.debug('Incoming request: ', req.body);
	core.commands.authorizeUser(req.params.user_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.subscribeUser(req.params.user_id, req.body.service_id, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});
});
app.post('/api/user/:user_id/unsubscribe', function (req, res){
	logger.debug('Incoming request: ', req.body);
	core.commands.authorizeUser(req.params.user_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.unsubscribeUser(req.params.user_id, req.body.service_id, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});
});
app.get('/api/user/:user_id/subscription', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.authorizeUser(req.params.user_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.getUserSubscription(req.params.user_id, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});

});
app.get('/api/user/:user_id/update', function (req, res){
	logger.debug('Incoming request: ', req.params);
	core.commands.authorizeUser(req.params.user_id, req.headers.authorization, function (err, auth){
		if(!err){
			if(auth == 1){
				core.commands.getUserUpdates(req.params.user_id, function (err, obj){
					sendResponse(err, obj, res);
				});
			} else sendResponse('Unauthorized', null, res);
		} else sendResponse(err, null, res);
	});


});
app.get('/api/company/search', function (req, res){
	logger.debug('Incoming request: ', req.query);
	core.commands.companySearch(req.query.term.toLowerCase(), function (err, obj){
		sendResponseSearch(err, obj, res);
	});
});

/* ------------------------ Starting server ---------*/
var server = app.listen(1982, '10.236.32.17', function() {
	console.log('Listening on address %s port %d',server.address().address, server.address().port);
});
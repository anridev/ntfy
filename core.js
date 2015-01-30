#!/usr/bin/env node

var redis 		 = require('redis');
var crypto 		 = require('crypto');
var async 		 = require('async');
var config 		 = require('./cfg/config.js');
var db 			 = redis.createClient(config.redis_port, config.redis_host, config.redis_options);
var push 		 = require('./push.js');

/*-----------Logging -----------*/
var log4js     	 = require('log4js');
log4js.configure('cfg/log4js.cfg', { reloadSecs: 300 });
var logger       = log4js.getLogger('core');
/*-----------Logging -----------*/

function isLast (element, arr){
	if(element == arr[arr.length - 1]) return true;
	return false;
}
function isHashExist (key_id, id, callback){
	db.hgetall(key_id + id, function (err,res){
		if(!err){
			if(!res) {
				callback("Key doesn't exist");
			} else callback(null, res);
		} else callback(err);
	});
}
function prefixMe (string, callback){
	var prefix_list = [];
	var prefix_str = '';
	function repeater (i){
		if(i < string.length) {
			prefix_list.push(string.substring(0,i).toLowerCase());
			repeater(i+1);				
		} else {
			prefix_list.push(string.substring(0,i).toLowerCase() + ':' + string + '\x00');
			callback(null, prefix_list);	
		}
	}
	repeater(1);
	
}
exports.commands = {
	addCompany	: function (name, description, city, country,  cb){
		logger.debug('name: ' + name + 'description: ' + description);
		async.waterfall([
			function (callback) {
				db.get('next_company_id', function (err, nc){
					if(!err){
						logger.debug('next company_id is: ' + nc);
						callback(null, nc);
					} else callback(err);
				});
			},
			function (nc, callback){
				db.hmset('companies', {
					"name"			: name,
					"company_id"	: nc
				}, function (err, res){
					if(!err){
						logger.debug('company ' + name + ' added');
						callback(null, nc);
					} else callback(err);
				});				
			},
			function (nc, callback){
				crypto.randomBytes(16, function(ex, buf) {
					if(!ex){
						var token = buf.toString('hex');
						logger.debug('token  ' + token + ' generated');
					} 
					callback(ex, nc, token);
				});
			},
			function (nc, token, callback) {
				db.hmset('companies:' + nc, {
					"name"			: name,
					"description"	: description,
					"city"			: city,
					"country"		: country

				}, function (err, res){
					if(!err){
						logger.debug('company_id ' + nc + ' added');
						callback(null, nc, token);
					} else callback(err);
				});
			},
			function (nc, token, callback){
				db.hset('companies:auths', token, nc, function (err, res){
					if(!err){
						logger.debug('new token added to companies:auths for company_id ' + nc);
						callback(null, nc, token);
					} else callback(err);
				});
			},
			function (nc, token, callback){
				prefixMe(name, function (err, prefix_list){
					var counter = 0;
					prefix_list.forEach(function(prefix){
						db.zadd('companies:index', 0, prefix, function (err, res){
							if(err) callback(err);
							else {
								counter++;
								if(counter == prefix_list.length) callback(null, nc, token);
							}
						});
					});

				});
			}
		],  function callback(err, nc, token){
				if (err) logger.error(err);
				else {
					db.incr('next_company_id');
					var obj = {
						'company_id' : nc,
						'token'		 : token
					}
				}
				cb(err, obj);
			}
		);
	},

	addService	: function (name, description, owner, cb){
		
		async.waterfall(
		[
			function (callback) {
				db.hgetall('companies:' + owner, function (err, res){
					if(!res) {
						callback("Owner company doesn't exist");
					} else callback(null);
				});
			},
			function (callback) {
				db.get('next_service_id', function (err, ns){
					if(!err){
						logger.debug('next service_id: ' + ns);
						callback(null, ns);
					} else callback(err);
				});
			},
			function (ns, callback) {
				db.hmset('services:' + ns, {
					"name"			: name,
					"description"	: description,
					"owner"			: owner 
				}, function (err, res){
					if(!err){
						logger.debug('service_id ' + ns + ' added');
						callback(null, ns);
					} else callback(err);
				});
			},
			function (ns, callback) {
				db.lpush('companies:' + owner + ':services', ns, function(err,r){
					if (!err){
						logger.debug('service_id ' + ns + ' added to company ' + owner + ' services');
						callback(null, ns);
					} else callback(err);

				});
			}
		],  function callback(err, ns){
				if (err) logger.error(err);
				else {
					db.incr('next_service_id');
					var obj = {
						'service_id' : ns
					}
				}
				cb(err, obj);
			}
		);
	},
	removeService : function (service_id, cb){
		async.waterfall(
		[
			function (callback){
				isHashExist('services:', service_id, callback);
			},
			function (temp, callback){
				db.hget('services:' + service_id, 'owner', function (err,res){
					if(err) callback(err);
					else {
						logger.debug('owner is: ', res);
						callback (null, res);
					}
				});
			},
			function (company_id, callback){
				db.del('services:' + service_id, function (err, r){
					if(err) callback(err);
					else callback(null, company_id);
				});
			},
			function (company_id, callback){/////????
				logger.debug('ready to remove companies:', company_id, ':services');
				db.lrem('companies:' + company_id + ':services', 0, service_id, function (err, r){
					if(err) callback(err);
					else callback(null, r);
				});
			}		
		],	function (err, res) {
				if (err) logger.error(err);
				else {
					var obj = {
						'description' : 'service removed'
					}
				}
				cb(err, obj);	
		});
	},
	getService 	: function (service_id, cb){
		db.hgetall('services:' + service_id, function (err, data){
			if(!err){
				if(data){
					var obj = {
						'service_info' : data
					}
					cb(null, obj);
				} else cb ('Service doesn\'t exist');
			} else cb(err);
		});
	},
	addUpdate	: function (service_id, update_body, cb){
		async.waterfall(
		[		
			function (callback) {
				db.hgetall('services:' + service_id, function (err, res){
					if(!err){
						if(!res) {
							callback("Service doesn't exist");
						} else callback(null);
					} else callback(err);
				});
			},			
			function (callback){
				db.get('next_update_id', function (err, nu){
					if(!err){
						logger.debug('next update_id: ' + nu);
						callback(null, nu);
					} else callback(err);
				});
			},
			function (nu, callback){
				db.hmset('updates:' + nu, {
					"service_id"			: service_id,
					"text"					: update_body 
				}, function (err, res){
					if(!err){
						logger.debug('update ' + nu + ' added');
						callback(null, nu);
					} else callback(err);
				});
			},
			function (nu, callback){
				db.zrevrange('services:' + service_id + ':followers', 0, -1, function (err, followers){
					if (err) callback(err);
					followers.forEach(function(f){
						db.lpush('users:' + f + ':updates', nu, function(err,r){
							if (err) callback(err);
						});	
					});
					callback(null, nu);
				});
			},
			function (nu, callback){
				db.lpush('services:' + service_id + ':updates', nu, function(err,r){
					if (!err){
						logger.debug('update ' + nu + ' added to service' + service_id);
						callback(null, nu);
					} else callback(err);
				});
			}
		],
			function (err, nu){
				if (err) logger.error(err);
				else {
					db.incr('next_update_id');
					var obj = {
						'update_id' : nu
					}
				}
				cb(err, obj);				
			}
		);
	},
	pushUpdate	: function (update_id, cb) {
		async.waterfall([
			function (callback){
				isHashExist('updates:', update_id, callback);
			},
			function (update, callback){
				db.zrevrange('services:' + update.service_id + ':followers', 0, -1, function (err, followers){
					if (!err) {
						callback(null, update, followers);
					} else callback(err);
				});				
			},
			function (update, followers, callback){
				db.hgetall('services:' + update.service_id, function (err, service){
					if (!err) {
						callback(null, service.name, service.owner, update, followers);
					} else callback(err);
				});
			},
			function (service_name, company_id, update, followers, callback){
				db.hget('companies:' + company_id, 'name', function (err, company_name){
					if (!err) {
						callback(null, service_name, company_name, update, followers);
					} else callback(err);					
				});
			},
			function (service_name, company_name, update, followers, callback){
				var all_devices = [];
				followers.forEach(function(f){
					db.lrange('users:' + f + ':push_devices', 0, -1, function(err, devices){
						if (!err) {
							devices.forEach(function(device){	
								if(isLast(device, devices) && isLast(f, followers)){
									all_devices.push(device);
									callback(null, service_name, company_name, all_devices);
								} else all_devices.push(device);
							});
						} else callback(err);
					});
				});
			}
		],
			function (err, service_name, company_name, devices){
				if(!err){
					var msg = company_name + '\n' + service_name;
					devices.forEach(function (device){
						push.commands.sendGCM(msg, [device], function(err,res){
							if(!err) logger.debug('GCM message sent: ' + res);
							else logger.error('Push sending error: ', err);
							if(isLast(device, devices)) cb(null, 1);
						});
					});
					
				} else {
					logger.error(err);
					cb(err);
				}
			}
		);
	},
	removeUpdate	: function (update_id, cb) {
		async.waterfall(
		[
			function (callback) {
				isHashExist('updates:', update_id, callback);
			},
			function (temp, callback) {
				db.hget('updates:' + update_id, 'service_id',function (err, res){
					if(!err){
						callback(null, res);
					} else callback (err);
				});
			},
			function (service_id, callback) {

				db.lrem('services:' + service_id + ':updates', 0, update_id, function (err, res){
					if(err) callback (err);
					else callback (null, 1);
				});
			},
			function (res, callback) {
				db.del('updates:' + update_id, function (err, r){
					if(err) callback(err);
					else callback(null, 1);
				});
			}
		],  function callback (err, res) {
				if(err) logger.error(err);
				cb(err, res);
			}
		);
	},
	getServiceOwner			: function (service_id, cb){
		db.hget('services:' + service_id, 'owner', function (err, res){
			if(!err){
				if(!res) {
					cb("Service doesn't exist", null);
				} else cb(null, res);
			} else cb(err, null);
		});
	},
	getUpdateOwner			: function (update_id, cb){
		db.hget('updates:' + update_id, 'service_id', function (err, sid){
			if(!err){
				db.hget('services:' + sid, 'owner', function (err, res){
					if(!err){
						if(!res) {
							cb("Service doesn't exist", null);
						} else cb(null, res);
					} else cb(err, null);
				});
			} else cb(err, null);
		});
	},
	getCompanyServices		: function (company_id, cb){
		async.waterfall([
			function (callback){
				isHashExist ('companies:', company_id, callback);
			},
			function (n, callback){
				db.lrange('companies:' + company_id + ':services', 0, -1, function(err,srv){
					var srvobj = {}
					if(!err) {
						srvobj = {
							'service_id' : srv
						}; 
					}
					callback(err, srvobj);
				});
			}], 
			function callback(err, obj){
				if(err) logger.error(err);
				cb(err, obj);
			}
		);
	},
	getServiceUpdates		: function (service_id, cb){
		async.waterfall([
			function (callback){
				db.hgetall('services:' + service_id, function (err, res){
					if(!err){
						if(!res) {
							callback("Service doesn't exist");
						} else callback(null);
					} else callback(err);
				});
			},
			function (callback){
				db.lrange('services:' + service_id + ':updates', 0, -1, function(err,updates){
					if(!err) {
						update_data = [];
						updates.forEach(function(update_id){
							db.hgetall('updates:' + update_id, function (err, u){
								if(err) callback(err);
								else {
									update_data.push({update_id:update_id, update_data:u});
									if (update_id == updates[updates.length - 1]){
										callback(null, update_data);
									}
								}
							});
						});
					} else{
						callback(err);
					}
				});
			}
			], 
			function callback(err, res){
				if (err) logger.error(err);
				var obj = {
					'updates' : res
				}
				cb(err, obj);	
			}
		);
	},
	getCompanyProfile	: function (company_id, cb){
		db.hgetall('companies:' + company_id, function (err, profile){
			if(err) cb(err);
			else {
				if(profile) {
					var profileobj = {
						'profile' : profile
					};
					cb (null, profileobj);
				}
				else cb('Company doesn\'t exist');
			}
		});
	},
	authorizeCompany : function (company_id, token, cb){
		if(token){
			async.waterfall([
				function (callback){
					db.hget('companies:auths', token, function (err,res){
						if(err) callback(err, 0);
						else {
							if(res) callback (null, res);
							else callback(null, 0);
						}
					});
				},
				function (cid, callback){
					if(cid == company_id){						
						callback(null,1);
					} else callback(null, 0);
				},

			],
			function callback(err, res){
				cb(err, res);
			});
		} else cb(null, 0);

	},
	addUser	: function (client_id, client_description, name, description, cb){
		async.waterfall(
		[
			function (callback){
				db.get('next_user_id', function (err, nu){
					if(!err){
						logger.debug('next user_id: ' + nu);
						callback(null, nu);
					} else callback(err);
				});
			},
			function (nu, callback){
				crypto.randomBytes(32, function(err, buf) {
					if(!err){
						var token = buf.toString('hex');
						logger.debug('token  ' + token + ' generated');
					} 
					callback(err, nu, token);
				});
			},
			function (nu, token, callback){
				db.hmset('users:' + nu, {
					"name"			: name,
					"description"	: description
				}, function (err, res){
					if(!err){
						logger.debug('user_id ' + nu + ' added');
						callback(null, nu, token);
					} else callback(err);
				});
			},
			function (nu, token, callback){
				db.hset('users:' + nu + ':clients', client_id, client_description, function (err, res){
					if(!err){
						callback(null, nu, token);
					} else callback(err);
				});
			},
			function (nu, token, callback){
				db.hset('users:auths', token,  nu, function (err, res){
					if(!err){
						logger.debug('new token added to auths for user_id ' + nu);
						callback(null, nu, token);
					} else callback(err);
				});
			}

		],  function callback (err, nu, token){
				if (err) logger.error(err);
				else {
					db.incr('next_user_id');
					var obj = {
						'user_id'  : nu,
						'token'	   : token
					}
				}
				cb(err, obj);
			}
		);
	},
	authorizeUser : function (user_id, token, cb){
		if(token){
			async.waterfall([
				function (callback){
					db.hget('users:auths', token, function (err,res){
						if(err) callback(err, 0);
						else {
							if(res) callback (null, res);
							else callback(null, 0);
						}
					});
				},
				function (uid, callback){
					if(uid == user_id){						
						callback(null,1);
					} else callback(null, 0);
				},

			],
			function callback(err, res){
				cb(err, res);
			});
		} else cb(null, 0);

	},
	subscribeUser : function (user_id, service_id, cb){
		async.waterfall(
		[	
			function (callback){
				isHashExist ('users:', user_id, callback);
			},
			function (temp, callback){
				isHashExist ('services:', service_id, callback);
			},			
			function (temp, callback){
				db.zadd (['users:' + user_id + ':following', Date.now(), service_id], function(err,r){
					if (!err){
						logger.debug('user ' + user_id + ' now following ' + service_id);
						callback(null, 1);
					} else callback(err);
				});
			},
			function (temp, callback){
				db.zadd(['services:' + service_id + ':followers', Date.now(), user_id], function(err,r){
					if (!err){
						logger.debug('user ' + user_id + ' added to ' + service_id + ' followers');
						callback(null, 1);
					} else callback(err);
				});				
			}
		],	function callback (err, r){
				var obj = {}
				if (err) logger.error(err);
				obj = {
					'description' : 'none'
				}
				cb(err, obj);	
			}
		);	
	},
	
	getUserUpdates	: function (user_id, cb){
		async.waterfall(
		[
			function (callback){
				isHashExist ('users:', user_id, callback);			
			},
			function (temp, callback){
				db.lrange('users:' + user_id + ':updates', 0, -1, function(err,updates){
					if(err) callback(err);
					else {
						if(updates.length>0) {
							var update_data = [];
							updates.forEach(function(u){
								db.hgetall('updates:' + u, function (err, ud){
									if(err) callback(err);
									else {
										update_data.push({update_id:u, update_data:ud});
										if (u == updates[updates.length - 1]){
											callback(null, update_data);
										}
									}
								});
							});
						} else callback (null, null);
					}
				});
			}
		], 	function callback(err, res){
				var obj = {}
				if (err) logger.error(err);
				else obj = {
					'updates' : res
				}
				cb(err, obj);					
			}
		);
	},
	getUserSubscription	: function (user_id, cb){
		async.waterfall(
		[
			function (callback){
				isHashExist ('users:', user_id, callback);			
			},
			function (temp, callback){
				db.zrevrange('users:' + user_id + ':following', 0, -1, function(err, following){
					if(err) callback(err);
					else {
						if(following) {
							callback(null, following);
						} else callback (null, null);
					}
				});
			}
		], 	function callback(err, res){
				var obj = {}
				if (err) logger.error(err);
				else obj = {
					'subscription' : res
				}
				cb(err, obj);					
			}
		);
	},	
	unsubscribeUser : function (user_id, service_id, cb){
		async.waterfall(
		[
			function (callback){
				isHashExist ('users:', user_id, callback);
			},
			function (temp, callback){
				isHashExist ('services:', service_id, callback);
			},
			function (temp, callback) {
				db.zrem('services:' + service_id + ':followers', user_id, function (err, res){
					if(err) {
						callback(err);
					}	else {
						db.zrem('users:' + user_id + ':following', service_id, function (err, res){
							if(err) {
								callback(err);
							}
							else callback(null, 1);
						});	
					}
				});
			}
		],  function callback(err, res){
				var obj = {}
				if (err) logger.error(err);
				obj = {
					'description' : 'none'
				}
				cb(err, obj);					
			}
		);
	},

	getUserProfile	: 	function (user_id, cb){
		async.waterfall(
		[
			function (callback) {
				db.hgetall('users:' + user_id, function (err, res){
					if(!err){
						if(!res) {
							callback("User doesn't exist");
						} else callback(null, res);
					} else callback(err);
				});
			}
		], function callback(err, res){
				var obj ={}
				if (err) logger.error(err);
				else obj = {
					'profile' : res
				}
				cb(err, obj);		
		   }
		);
	},


	companySearch 	: function (string, cb){
		db.zrank('companies:index', string, function (err, index){
			if(!err){
				if(index){
					db.zrange('companies:index', index, index+100, function(err, results){
						if(!err){
							var final_result = [];
							results.forEach(function(r){
								if(r.indexOf('\x00')>-1){
									if(r.toLowerCase().indexOf(string.toLowerCase())>-1) {
										r=r.substring(r.indexOf(':') + 1,r.length-1);
										final_result.push(r);
									}
								}
							});
							cb(null, final_result);
						} else cb(err);
					});
				} else 	cb(null, ['No results found']);
			} else cb(err);
		});
	} 
}

db.incr('next_company_id');
db.incr('next_service_id');
db.incr('next_user_id');
db.incr('next_update_id');


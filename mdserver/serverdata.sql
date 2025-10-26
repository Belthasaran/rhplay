CREATE TABLE serveroptions (
	optionuuid VARCHAR(255),
	setting_name VARCHAR(255),
	setting_value VARCHAR(255),
	PRIMARY KEY(optionuuid),
	UNIQUE(setting_name)
);

CREATE TABLE apiclients (
	clientuuid VARCHAR(255),
	encrypted_clientid VARCHAR(255),
	admin_client INTEGER DEFAULT 0,
	encrypted_secret VARCHAR(255),
	client_name VARCHAR(255),
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	last_access TIMESTAMP,
	access_count INTEGER DEFAULT 0,
	PRIMARY KEY(clientuuid),
	UNIQUE(encrypted_clientid)
);

CREATE TABLE apilogs (
	loguuid VARCHAR(255),
	clientuuid VARCHAR(255),
	endpoint VARCHAR(255),
	method VARCHAR(255),
	status_code INTEGER,
	request_data TEXT,
	response_size INTEGER,
	timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(loguuid),
	FOREIGN KEY(clientuuid) REFERENCES apiclients(clientuuid)
);

CREATE TABLE signers (
	signeruuid varchar(255),
	signer_name varchar(255),
	signertype varchar(255),
	publickey_type varchar(255) DEFAULT 'ED25519',
	hashtype varchar(255) DEFAULT 'SHA256',
	publickey varchar(255) NOT NULL,
	siglistuuid varchar(255),
	primary key(signeruuid)
);

CREATE TABLE signaturelists(
	siglistuuid varchar(255),
	primary key(siglistuuid)
);

CREATE table signaturelistentries (
	siglistentryuuid varchar(255),
	siglistuuid varchar(255),
	signeruuid varchar(255) references signers(signeruuid),
	hash_type varchar(255),
	hash_value varchar(255),
	signature text,
	primary key(siglistentryuuid),
	unique(siglistuuid, signeruuid)
);

CREATE TABLE ipfsgateways (
	gwuuid varchar(255),
	url varchar(255),
	priority INTEGER DEFAULT 100,
	notworking_timestamp TIMESTAMP,
	lastsuccess_timesteamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	error text,
	notes text,
	PRIMARY KEY(gwuuid),
	UNIQUE(url)
);

CREATE TABLE donotsearch (
	entryuuid varchar(255),
        url varchar(255),
	location varchar(255),
	stop_time  int DEFAULT 17200,
	server_response text,
        since TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	primary key(entryuuid)
);

CREATE TABLE attachments (
  auuid varchar(255) primary key DEFAULT (uuid()),
  pbuuid varchar(255),
  gvuuid varchar(255),
  resuuid varchar(255),
  siglistuuid varchar(255) references signaturelists,
  file_crc16 varchar(255) NOT NULL,
  file_crc32 varchar(255) NOT NULL,
  locators text,
  parents text,
  file_ipfs_cidv0 varchar(255) NOT NULL,
  file_ipfs_cidv1 varchar(255) NOT NULL,
  file_hash_sha224 varchar(255) NOT NULL,
  file_hash_sha1 varchar(255) NOT NULL,
  file_hash_md5 varchar(255) NOT NULL,
  file_hash_sha256 varchar(255) NOT NULL,
  file_name varchar(255) NOT NULL,
  filekey varchar(255) NOT NULL,
  decoded_ipfs_cidv0 varchar(255) NOT NULL,
  decoded_ipfs_cidv1 varchar(255) NOT NULL,
  decoded_hash_sha224 varchar(255) NOT NULL,
  decoded_hash_sha1 varchar(255) NOT NULL,
  decoded_hash_md5 varchar(255) NOT NULL,
  decoded_hash_sha256 varchar(255) NOT NULL,
  updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  import_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  download_urls varchar(255),
  arweave_file_name varchar(255),
  arweave_file_id varchar(255),
  arweave_file_path varchar(255),
  last_search TIMESTAMP DEFAULT NULL,
  file_size bigint,
  file_data blob,
  UNIQUE(file_name,file_hash_sha224)
)

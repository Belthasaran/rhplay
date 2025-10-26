CREATE TABLE gameversions (
  gvuuid varchar(255) primary key DEFAULT (uuid()),
  section varchar(255),
  gameid  varchar(255),
  version int,
  removed int default 0,
  obsoleted int default 0, 
  gametype varchar(255),
  name    varchar(255) NOT NULL,
  time    varchar(255),
  added   varchar(255),
  moderated varchar(255),
  author  varchar(255),
  authors varchar(255),
  submitter varchar(255),
  demo varchar(255),
  featured varchar(255),
  length varchar(255),
  difficulty varchar(255),
  url varchar(255),
  download_url varchar(255),  
  name_href varchar(255),
  author_href varchar(255),
  obsoleted_by varchar(255),
  patchblob1_name varchar(255),
  pat_sha224 varchar(255),
  size varchar(255),
  description text,
  gvjsondata text,
  gvchange_attributes text,
  gvchanges text,
  tags text,
  tags_href text,
  fields_type varchar(255),
  legacy_type varchar(255),
  raw_difficulty varchar(255),
  combinedtype varchar(255),
  local_resource_etag varchar(255),
  local_resource_lastmodified TIMESTAMP,
  local_resource_filename varchar(500),
  gvimport_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  siglistuuid varchar(255),
  UNIQUE(gameid, version)
  );

CREATE TRIGGER kv_autoversion AFTER INSERT ON gameversions
WHEN new.version IS NULL BEGIN
    UPDATE gameversions SET version = (SELECT COALESCE(MAX(version), 0) + 1 FROM gameversions) WHERE gameid = new.gameid;
END;

CREATE TABLE rhpatches (
        rhpuuid varchar(255) primary key DEFAULT (uuid()),
        gameid varchar(255) references gameversions (gameid),
        patch_name varchar(255),
        siglistuuid varchar(255),
	UNIQUE(patch_name)
);


CREATE TABLE patchblobs (
   pbuuid varchar(255) primary key DEFAULT (uuid()),
   gvuuid varchar(255) REFERENCES gameversions (gvuuid),
   patch_name varchar(255),
   pat_sha1 varchar(255),
   pat_sha224 varchar(255),
   pat_shake_128 varchar(255),
   patchblob1_key varchar(255),
   patchblob1_name varchar(255),
   patchblob1_sha224 varchar(255),
   result_sha1 varchar(255),
   result_sha224 varchar(255),
   result_shake1 varchar(255),
   pbjsondata text,
   pblobdata blob,
   pbimport_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
   siglistuuid varchar(255),
   UNIQUE(patchblob1_name)
);



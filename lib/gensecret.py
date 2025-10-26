#!/usr/bin/python

import requests
import getpass
import json
import csv
import sys
import os
import time
import base64
import traceback
import hashlib
import urllib.parse

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

DEFAULT_STORE_NAME = '_x'

def save_secrets(dict, filename=None,frnkeyd=None,storename=DEFAULT_STORE_NAME):
    """
    dict - Dictionary containing the   secret  key-data pairs

    Optional from function parameters or system environment:
    filename - The file to store secrets at
    frnkeyd - The fernet key used for encryption

    If optional values are not set, then the corresponding environment variables must be present.
    """
    if frnkeyd == None and f'FSECKEY{storename}' in os.environ:
        frnkeyd = os.environ[f'FSECKEY{storename}']
    if filename == None and  not(f'FSECFILE{storename}' in os.environ):
        raise Exception("Secrets path unspecified")
    if filename == None:
        filename = os.environ[f'FSECFILE{storename}']
    else:
        filename = str(filename)
    
    frnkey = None
    if frnkeyd:
        frnkey = Fernet(frnkeyd)

    client_id = ''
    client_secret = ''
    app_token = ''

    if 'client_id' in dict:
        client_id = dict['client_id']
    if 'client_secret' in dict:
        client_secret = dict['client_secret']
    if 'app_token' in dict:
        app_token = dict['app_token']

    original_umask = os.umask(0o077)
    try:
        with open(str(filename) + ".new", 'w') as soutfile:
            buffer = ''
            for ik in dict.keys():
                buffer = buffer + base64.urlsafe_b64encode( bytes(ik,'utf8') ).decode('utf8') + "\n"
                buffer = buffer + base64.urlsafe_b64encode( bytes(dict[ik],'utf8') ).decode('utf8') + "\n"
            soutfile.write(str(frnkey.encrypt(bytes(buffer + "\n", 'utf8')).decode('utf8') ))
        os.umask(original_umask)
        os.rename(str(filename) + ".new", filename)
    finally:
        os.umask(original_umask)
    #except Exception as xerr:
    #    raise self.exc_info[1], None, self.exc_info[2]
    return 1

def get_secrets(filename=None,frnkeyd=None,onekey=None,storename=DEFAULT_STORE_NAME):
    """
    Retrieve a secret from the secrets storage

    Optional:
    filename - Path to file storing the secrets
    frnkeyd - Fernet key used to encrypt the secrets storage
    onekey -  Name of the database key to retrieve

    If onekey is specified, then the Return result is the contents of the database key.

    If onekey input is None, then the Return result is a dictionary of the stored secrets.
    """
    if frnkeyd == None and f'FSECKEY{storename}' in os.environ:
        frnkeyd = os.environ[f'FSECKEY{storename}']
    if filename == None and  not(f'FSECFILE{storename}' in os.environ):
        raise Exception(f"Secrets{storename} path unspecified")
    if filename == None:
        filename = os.environ[f'FSECFILE{storename}']
    else:
        filename = str(filename)

    frnkey = None
    if frnkeyd:
        frnkey = Fernet(frnkeyd)

    dict={}
    client_id=""
    client_secret=""
    app_token=""
    skipnext=0
    try:
        with open(filename, 'r') as secretfile:
            filedata = (frnkey.decrypt( bytes(secretfile.read(),'utf8') )).decode('utf8').split('\n')
            #print(str(filedata))
            #dict['client_id'] = filedata[0]
            #dict['client_secret'] = filedata[1]
            #dict['app_token'] = filedata[2]
            for i in range(0,len(filedata),2):
                if skipnext:
                    skipnext=0
                    continue
                if not(filedata[i]) or filedata[i] == '':
                    #print('SK')
                    skipnext=1
                    continue
                ###
                key_s = base64.urlsafe_b64decode(filedata[i]).decode('utf8')
                value_s = base64.urlsafe_b64decode(filedata[i+1]).decode('utf8')
                dict[key_s] = value_s
                key_s = None
                value_s = None
        if not(onekey):
            return dict
        if onekey in dict:
            return dict[onekey]
        return None
    except Exception as exc1:
        print("Unable to read Twitch API secrets from twsecrets: " + str(exc1))
        traceback.print_exc()
        return None

####
def add_secret(args):
    tkeys = get_secrets().keys()
    print("Existing entries:")
    for ik in tkeys:
        print(str(ik))
    key_s = input('Enter key string:').lower()
    value_s = input('Enter vlaue string:')
    tdict = get_secrets()
    tdict[key_s] = str(value_s)
    save_secrets(tdict)
    #print(str(tdict))


def handler_function(args):
    ftok = None
    fpath = None

    if len(args)>1 and args[1].upper()=='SETUP':
        setup_secret_storage(args)
    else:
        if not('FSECKEY_x' in os.environ):
            print('***')
            print('Secrets database is encrypted')
            print('***')
            print('Please enter the Fernet token to manage secrets:')
            ftok = getpass.getpass('key: ')
        else:
            ftok = os.environ['FSECKEY_x']
            del os.environ['FSECKEY_x']
        #
        #
        if not('FSECFILE_x' in os.environ):
            fpath = input('Enter path to secrets storage:')
        else:
            fpath = os.environ['FSECFILE_x']
            del os.environ['FSECFILE_x']


    if len(args)>1 and args[1].upper()=='READ':
        confirm=input('Press [y] to confirm read: ')
        if (confirm=='y'):
            print(json.dumps(get_secrets(filename=fpath, frnkeyd=ftok, storename='_x'),indent=4))
    elif len(args)==2 and args[1].upper()=='SPAWNSHELL':
        #
        #os.environ[f'FSECKEY{storename}']
        #
        sd = get_secrets( filename=fpath, frnkeyd=ftok, storename='_x'  )
        #
        for u in sd.keys():
            os.environ[f'rtr_{u}'] = sd[u]
        print('[starting clean subprocess with secrets in environment: starting bash shell]')
        os.system("/bin/bash -l")
    else:
        os.environ['FSECKEY_x'] = ftok
        os.environ['FSECFILE_x'] = fpath
        add_secret(args)
        del os.environ['FSECKEY_x']
        del os.environ['FSECFILE_x']
    pass

if __name__ == '__main__':
    handler_function(sys.argv)

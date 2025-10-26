# Copyright C Belthasar 2023 All Rights Reserved

from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys
import loadsmwrh
import db_addhack

def addall_function(args):
    files = os.listdir('hacks')
    for filename in files: 
        if re.match('^[a-z0-9]+$', filename) and not(filename == 'result'):
            db_addhack.addhack_function(['addhack', filename])

if __name__ == '__main__':
    addall_function(sys.argv)
    
    
    
    
 

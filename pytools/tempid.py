from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys
import time

def hash_shake_function(args):
    filename = args[1]
    
    try:
        resultf = open(filename, "rb")
        data = resultf.read()
        resultf.close()
        shake1 = (base64.b64encode(hashlib.shake_128(data).digest(24), b"_-")).decode('latin1')
        shake1 = shake1 + str(time.time())[::-1]
        shake1 = re.sub('[^0-9a-zA-z]','', shake1)
        print('l_%d%s' % ( int(time.time()/3600),  shake1[0:6]  ) )
    except Exception as ex1:
        print('Error: ' + str(ex1))
     

if __name__ == '__main__':
    hash_shake_function(sys.argv)
    
    
    
    
 

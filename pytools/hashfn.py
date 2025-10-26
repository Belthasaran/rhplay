from zipfile import ZipFile
import re
import hashlib
import base64
import os
import json
import sys

def hash_shake_function(args):
    filename = args[1]
    
    try:
        resultf = open(filename, "rb")
        data = resultf.read()
        resultf.close()
        shake1 = (base64.b64encode(hashlib.shake_128(data).digest(24), b"_-")).decode('latin1')
        print('Shake128_digest24_b_-(%s) = %s' % ( filename, shake1 ))
    except Exception as ex1:
        print('Error: ' + str(ex1))
     

if __name__ == '__main__':
    hash_shake_function(sys.argv)
    
    
    
    
 

from zipfile import ZipFile
import re
import hashlib
import base64
import os
import os
import json
import sys
from compress import Compressor               

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

textdata = input('Text:')
xsha224 = hashlib.sha224( (bytes(32) + bytes(textdata,'utf8') + bytes(32))  ).hexdigest()
password = bytes(xsha224, 'ascii')
salt = os.urandom(16)
kdf = PBKDF2HMAC( algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000, )
key = base64.urlsafe_b64encode(kdf.derive(password))
frn = Fernet(key)
#frndata = frn.encrypt(bindata)
print(key.decode('utf8'))


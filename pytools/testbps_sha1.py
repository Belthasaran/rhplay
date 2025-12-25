
import sys
import subprocess
import os
import hashlib

BUF_SIZE = 65536

tempdir='/tmp/temp1.'+str(os.getpid())
for pat in sys.argv[1:]:
    if not(os.path.isdir(tempdir)):
        os.mkdir(tempdir)
    try:
        subprocess.run(['flips', '--apply', pat, '/usr/local/share/smw.sfc', tempdir+'/test.sfc'], check=True)
        f = open(tempdir+'/test.sfc','rb')
        sha1 = hashlib.sha1()
        while True:
            data = f.read(BUF_SIZE)
            if not data:
                break
            sha1.update(data)
        f.close()
        print(sha1.hexdigest() + ' ' + pat)
        #subprocess.run(['sha1sum', tempdir+'/test.sfc'], check=True)
    finally: 
        if os.path.isfile(tempdir+'/test.sfc'):
            os.unlink(tempdir+'/test.sfc')
os.rmdir(tempdir)



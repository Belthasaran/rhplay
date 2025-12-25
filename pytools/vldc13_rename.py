import os
import sys
import re
import subprocess
import hashlib

explines="""
2b0a6e9b6505a9f84154b62a03e7dee6c25cafb9 SMWC Vanilla LDC 13 [#01-R18] - Tubular (Hard Mode) by Heraga [2022-04-27] (SMW Hack)
94e2a9bf4b4971e66b31d8bf29e257bc329eaf97 SMWC Vanilla LDC 13 [#02-R07] - Time in Amber by GbreezeSunset [2022-04-27] (SMW Hack)
fb396f47993551d01f176e4ddc37234200aa86d9 SMWC Vanilla LDC 13 [#03-R08] - Babylon by Samuel Zuccati [2022-05-28] (SMW Hack)
aaf27bcf53a201ea514ab8a245e8a6e7b3511793 SMWC Vanilla LDC 13 [#04-R19] - Winds by Kori [2022-05-10] (SMW Hack)
3f5cc10cdd0bf13e7eeac39f6d1a1367d257e7b8 SMWC Vanilla LDC 13 [#05-R65] - Loopy Lament by ninj [2022-04-29] (SMW Hack)
23139ca061bd0da5ea959738061d2a9796271ae7 SMWC Vanilla LDC 13 [#06-R55] - Mirage Breeze (V2F) by Dispace [2022-05-28] (SMW Hack)
51561dbef209824b3e81bde59ceb03e211826f3b SMWC Vanilla LDC 13 [#07-R76] - Crown Thief by Boosius [2022-04-30] (SMW Hack)
a03c547b7fff42be2093b6c62ea9f88950b50d5b SMWC Vanilla LDC 13 [#08-R32] - Unknown Force by TS_N [2022-04-30] (SMW Hack)
7ef528111d6a94e6b72a6426163e7b035bf56841 SMWC Vanilla LDC 13 [#09-R60] - Night at the Museum by blocc [2022-05-01] (SMW Hack)
d1b656662d2f6396d98f018bc0c71045bf25f8a6 SMWC Vanilla LDC 13 [#10-R56] - Purple Valley Trail (V2.2) by IronFoxGaming [2022-05-29] (SMW Hack)
07d685fad8ea26de9465f8b9dfa4717251a758b2 SMWC Vanilla LDC 13 [#11-R61] - Sacred Forest (Updated) by DetectiveZvarri [2022-05-04] (SMW Hack)
e66c660ad497754f2171f26b3b993086d42e7f18 SMWC Vanilla LDC 13 [#12-R70] - Garden of Eden (V1.2) by AnEvilGhost [2022-05-21] (SMW Hack)
a95c75c0b5029e3e894a0186fe24b227dea3a5b6 SMWC Vanilla LDC 13 [#13-R34] - Cosmosis by bry [2022-05-05] (SMW Hack)
faae70e8e3a1be2951e9f29b3c7ba726bc62eae8 SMWC Vanilla LDC 13 [#14-R47] - Space Highway (V1.0.1) by Zavok + Green Jerry [2022-05-25] (SMW Hack)
52a2a49b73b5420eb2e995947a4e4cadf1694c63 SMWC Vanilla LDC 13 [#15-R51] - Spooky Wacko Stage by Spade_Magnes [2022-05-08] (SMW Hack)
2fea5f2702cf362b4240da595fdd9a6602249ed7 SMWC Vanilla LDC 13 [#16-R79] - Abuscence by Ryman [2022-05-29] (SMW Hack)
0a788c444e6335e03c578526a8519a1f5de8707b SMWC Vanilla LDC 13 [#17-R44] - Sapphire Shores by Donut + Segment1Zone2 [2022-05-10] (SMW Hack)
6d7cf7affdd8b5f9a48bbf4a75fe5dba587420ac SMWC Vanilla LDC 13 [#18-R48] - Hydrotemple (V1.0.0) by yogui [2022-05-13] (SMW Hack)
c710452a48066b1df0e42bde6a3eaa6cf376f9c9 SMWC Vanilla LDC 13 [#19-R28] - Note Block Surfing (Update 2) by Anas [2022-05-28] (SMW Hack)
a9199d9a86af09cdbe2cc5e2f569fcf8398db2d5 SMWC Vanilla LDC 13 [#20-R43] - Veggie Valley (V1.1) by LuigiTime (MoxieCat) [2022-05-15] (SMW Hack)
2609675c08f06a71ce2bca7e7e3fef30b4d925c1 SMWC Vanilla LDC 13 [#21-R34] - The Wet Coast (V1.1) by Soul Storm [2022-05-16] (SMW Hack)
8c34f07aa4013f95279029665fefeb8c6bb5f9c0 SMWC Vanilla LDC 13 [#22-R63] - The Boring Blossom Forest by KekShadow_08 [2022-05-15] (SMW Hack)
177ce28af67fd6a9953e1aadb7da89af2f25c615 SMWC Vanilla LDC 13 [#23-R46] - VLDC Entryy #1 (Update) by 2pvenezuela [2022-05-29] (SMW Hack)
c32038d31b3594bb815f567d0a8cce1604c5a155 SMWC Vanilla LDC 13 [#24-R03] - Hydro Fights by FrozenQuills [2022-05-18] (SMW Hack)
5a33bb175bbffdfcb367db147010742de9c1d944 SMWC Vanilla LDC 13 [#25-R45] - Pokey Berry Pass (V2.0) by RZ1 [2022-05-29] (SMW Hack)
4bfca532130c78d7b5fa7d8ad06ca02460b8f886 SMWC Vanilla LDC 13 [#26-R74] - RGB Plains by Fostelif [2022-05-21] (SMW Hack)
db187726e1d4b40ea00cc23cf33d7c85dde47e7e SMWC Vanilla LDC 13 [#27-R04] - Frigid Stronghold by Sixcorby [2022-05-22] (SMW Hack)
db0170e1059e00ca420fd7d58dc0c97e3602c796 SMWC Vanilla LDC 13 [#28-R27] - Deforested Factory (V1.0) by TheOrangeToad [2022-05-23] (SMW Hack)
70b349b4bb2435abedb8d7ac9f28f2aaba9f1d54 SMWC Vanilla LDC 13 [#29-DQ] - An Odd Bridge by LUHOINK [2022-05-23] (SMW Hack)
b18431d17997951f5f2af1f30fb7cb3d69c080ac SMWC Vanilla LDC 13 [#30-R53] - Moon Mountain (V1.1) by Nanny_Skeksis [2022-05-24] (SMW Hack)
91fde0343d32f586267b0c9c95fd61bf30b5a25e SMWC Vanilla LDC 13 [#31-R01] - Vividsection by idol + Squirrelyman157 [2022-05-30] (SMW Hack)
071d84fb818e5d754844acc9ee46d3fe2d414568 SMWC Vanilla LDC 13 [#32-R29] - Prehistoric Lift by TheJavabrew [2022-05-28] (SMW Hack)
83622812976d93082017046f81d040b2991e7ad8 SMWC Vanilla LDC 13 [#33-R26] - Pastel Peak by Idunno [2022-05-24] (SMW Hack)
19ec4a824bb00166b697677bcd9cb2ec0b14567a SMWC Vanilla LDC 13 [#34-R56] - Chainsaw Mountain (V1.2) by YoungsVideos44 [2022-05-25] (SMW Hack)
01bc42904ffc9681ce1d2a6086083fb9c1d3a7b3 SMWC Vanilla LDC 13 [#35-R67] - Mixed Grassland by yoshi9429 [2022-05-28] (SMW Hack)
80d8d91dd02f44d37e750cf0c52a6081e1ca683f SMWC Vanilla LDC 13 [#36-R85] - Time Machine by MarkVD100 [2022-05-25] (SMW Hack)
6e05379f47574bb44ed338d7089361889e5f1e01 SMWC Vanilla LDC 13 [#37-R36] - Mario Becomes an Amazon Delivery Worker (V1.2) by ghyn [2022-05-29] (SMW Hack)
dda9d1f613f022fb41bbb0c857c39335911a00c7 SMWC Vanilla LDC 13 [#38-R38] - Cocoa-Mint Corp. by SMWizard [2022-05-26] (SMW Hack)
daf54fc62b7346802dcf9e130e0e8fc86a46956c SMWC Vanilla LDC 13 [#39-R15] - Trials of the Great Caverns (V2) by Daizo Dee Von + EvilGuy0613 [2022-05-26] (SMW Hack)
a3885b78b59a3968ecd34ed1b527aa87df874d4e SMWC Vanilla LDC 13 [#40-R19] - Windy Overpass by PiyoPiyori [2022-05-26] (SMW Hack)
ef5e097241e2680bfc8aea9c5ec3efcb6b6dd24f SMWC Vanilla LDC 13 [#41-R59] - Warfield Wilderness by N450 [2022-05-27] (SMW Hack)
1c18e3c55739b0faa7b743c27a96fcf8c8d50c61 SMWC Vanilla LDC 13 [#42-R62] - Lake Coolidge by Eli Jenkins YK [2022-05-27] (SMW Hack)
229065b31934a75c23e5fdabe3acfa97930520dc SMWC Vanilla LDC 13 [#43-R29] - Twilight Lunar (V1.01) by PokerFace [2022-05-29] (SMW Hack)
9847e34dc5637f2acecb169c2e974a35f52e1fa8 SMWC Vanilla LDC 13 [#44-R13] - Piscine Molitor (V1.1) by Nitrogen [2022-05-29] (SMW Hack)
923b3c08b16fbdef5cab13860801b3e810bc0420 SMWC Vanilla LDC 13 [#45-R66] - Aurum Fever by Blizzard Buffalo [2022-05-27] (SMW Hack)
2211cdaa83bb52090f196afa7dffa33b010f0efa SMWC Vanilla LDC 13 [#46-R58] - The Last Yoshi by Fruitloops [2022-05-27] (SMW Hack)
bf6a454f788be651cd5ee2d1a1f4163e725d2e47 SMWC Vanilla LDC 13 [#47-R24] - Sky Zone by Enan63 [2022-05-27] (SMW Hack)
ff48e64cbaf0b63a5f6b4cd649160f332bbb78e9 SMWC Vanilla LDC 13 [#48-R36] - Useless and Nasty (V1.1) by Dr. Gaspacho [2022-05-28] (SMW Hack)
f0d4fdb9006379c8669cd2b190bef615829a2dac SMWC Vanilla LDC 13 [#49-R75] - Season Twilights by OrangeBronzeDaisy + xyz600sp [2022-05-28] (SMW Hack)
ff955b9e025e15d73a05dc4ce878a6d80e7466b2 SMWC Vanilla LDC 13 [#50-R83] - Opassa Beach by GabrielJohn [2022-05-28] (SMW Hack)
8547cc6802a86f1939ba01913c206359ce036dbd SMWC Vanilla LDC 13 [#51-R16] - Consumer Construct by Ruberjig [2022-05-28] (SMW Hack)
837a3b26a9d6be188e2fc1f9d48ca84c8bb5405a SMWC Vanilla LDC 13 [#52-R73] - Peach's Palace by huebrbr [2022-05-29] (SMW Hack)
b4b24174fb3d42ea7537fd7feb79297482e370dd SMWC Vanilla LDC 13 [#53-R54] - East Castle Walls by Roberto Zampari [2022-05-28] (SMW Hack)
35ad0640ec4fb09cf05274041f9f0aca53aa9311 SMWC Vanilla LDC 13 [#54-R21] - Steel Shores by rosysunrise_ [2022-05-28] (SMW Hack)
18d6340f8cce743aad6858e84eae0ac445fac5b0 SMWC Vanilla LDC 13 [#55-R10] - Eating Block Story (V1.2) by SomeGuy712x [2022-05-30] (SMW Hack)
827820194ca6e77bbc462c2f7291fda3a5aef652 SMWC Vanilla LDC 13 [#56-R70] - A Walk in Greenpath by Sacri Pan [2022-05-28] (SMW Hack)
3cb6d772ccaba8f9f7a95f510d5d51263cf89430 SMWC Vanilla LDC 13 [#57-R42] - It's New Donk! by TickTockClock [2022-05-29] (SMW Hack)
65c45b7afc52f1198c30ba40efc94405080ef9d6 SMWC Vanilla LDC 13 [#58-R77] - Fast-Desire Drive (V1.01a) by Shiki_Makiro [2022-05-29] (SMW Hack)
c3d03450b07dab09d57d7ffa17379cf9f6b71443 SMWC Vanilla LDC 13 [#59-R72] - DJMARIO Respect (V1.02) by Lsh0426 [2022-05-29] (SMW Hack)
e70bf751100598747de59a31bf97f0145d7221a8 SMWC Vanilla LDC 13 [#60-R09] - Starlight-Ride (V1.1) by Sariel [2022-05-29] (SMW Hack)
26f07a204d27e5b2a4c7cef34fb918681e4db9bf SMWC Vanilla LDC 13 [#61-R69] - Run Yoshi Run by JP32 [2022-05-29] (SMW Hack)
499962b0c4ff31a2e76e450cb664da05e5fc39e1 SMWC Vanilla LDC 13 [#62-R78] - Super Bonus World by qantuum [2022-05-29] (SMW Hack)
3f693e04e0d7d19ae5bb01f5f220f5a89754ce80 SMWC Vanilla LDC 13 [#63-R32] - Scorching Sands by Spedinja [2022-05-29] (SMW Hack)
01b88fafbb377a6357a94a6c4162f275b1c25553 SMWC Vanilla LDC 13 [#64-R63] - Sakura Winds (Fixed) by Julintendo [2022-05-29] (SMW Hack)
1cd23168bc169fbf44010f5cf778d33280fa1f7c SMWC Vanilla LDC 13 [#65-R41] - Thwomp Stomp Cavern (Fixed) by Humberto Quackenbush [2022-05-29] (SMW Hack)
a00ccff59447f1f0f5ebd19cfad8950769efc6b0 SMWC Vanilla LDC 13 [#66-R13] - HAHAHA, YEs... CHUnks by Enjl + Waddle [2022-05-29] (SMW Hack)
33736d849f845bb7c3cccaa03e4ca15ede06e53d SMWC Vanilla LDC 13 [#67-R06] - Buzzsaw Blueshift by HamOfJustice [2022-05-29] (SMW Hack)
b5607a361970f2058b24c5edaa2fde4591e3c1bc SMWC Vanilla LDC 13 [#68-R81] - Golden Switch Trail by solgaleo35 [2022-05-29] (SMW Hack)
f44e0091be1b2345186c926642d74ea68067380f SMWC Vanilla LDC 13 [#69-R11] - Blue Cutting Sector by Aurel509 [2022-05-29] (SMW Hack)
04152ca376e3720b02cda123fd84aa7b73e5505c SMWC Vanilla LDC 13 [#71-R21] - Cloudgazing by snoruntpyro [2022-05-29] (SMW Hack)
62e1e9054e49672e303ab5c20413c33efcb585c1 SMWC Vanilla LDC 13 [#72-R67] - Hibernal Woodland by Yui-Drakon [2022-05-29] (SMW Hack)
3ae325371227a0cd4da9e240f1365ea8a5c4e85b SMWC Vanilla LDC 13 [#73-R50] - Urbano (V1.1) by Pinci [2022-05-30] (SMW Hack)
01638dadd414463b1931e1ba0d5baddb719c5b4c SMWC Vanilla LDC 13 [#74-R84] - Haunted Riverwalk by wolfnasty [2022-05-30] (SMW Hack)
58fbf64b2591a907a36b8f22b7d451518e1d4455 SMWC Vanilla LDC 13 [#75-R25] - Nychthemeron by E-man38 + bebn legg [2022-05-30] (SMW Hack)
19cf25717fea2bbac04429b305cff42e9c296b85 SMWC Vanilla LDC 13 [#76-R52] - Lady Crithania by PSI Ninja [2022-05-30] (SMW Hack)
b824d859ebf0635ec9ed91d9f2f7b14f558524b0 SMWC Vanilla LDC 13 [#77-R17] - Lay Low by Lazy + lolyoshi [2022-05-30] (SMW Hack)
91d15895e024ec74e380e84ebd20810381a609d5 SMWC Vanilla LDC 13 [#78-R81] - Thiana's Gold Trail by Klug [2022-05-30] (SMW Hack)
21305cac48972aa52eafd047eac18cc3aa9f30e5 SMWC Vanilla LDC 13 [#79-R38] - Moonlit Mayhem by Yoshi Master + Domanasaur [2022-05-30] (SMW Hack)
3a74775ea8a52fbb19f6fdc6b93b3ab6b88c49c8 SMWC Vanilla LDC 13 [#80-R40] - Clair de Lune (V1.21) by Kusrry [2022-05-30] (SMW Hack)
33f520e92d82eb624528a3e917bdaf2e3dc811fe SMWC Vanilla LDC 13 [#81-R31] - Dolphin Coast (V1.1) by codfish1002 [2022-05-30] (SMW Hack)
e244467feb622fbee51820e04e7ba2d130854bc1 SMWC Vanilla LDC 13 [#82-R80] - Lame Kickin' by Kevin [2022-05-30] (SMW Hack)
0868bd2e0d668f55a8cf414fb7534608c84b5843 SMWC Vanilla LDC 13 [#83-R49] - Entry by Azula16 [2022-05-30] (SMW Hack)
e1a125c3075ac255c912a50f7b584cc59df1da47 SMWC Vanilla LDC 13 [#84-R23] - Magmatic Morgue by MegaMarioMan9 [2022-05-30] (SMW Hack)
efe3d151b229120e11ab6adea7d6e79361586818 SMWC Vanilla LDC 13 [#85-R05] - Neo Atlantis by Aeon + Magi [2022-05-30] (SMW Hack)
626678f5b041af2afbdaaf39266a1bcbd211db4d SMWC Vanilla LDC 13 [#86-R11] - Clown Fiesta by NGB [2022-05-30] (SMW Hack)
f066fb81fa969c2def9006c3c790e2f26e74f694 SMWC Vanilla LDC 13 [#87-R02] - Custom Block Party by MM102 [2022-05-30] (SMW Hack)
""".splitlines();

hashfile = {}
for ex in explines:
    tokens = ex.split(' ', 1)
    if tokens and len(tokens) > 1:
        hashfile[ tokens[0] ] = tokens[1]

def testpatch_sha1(patchfile):
    BUF_SIZE = 65536
    tempdir = '/tmp/temp1.'+str(os.getpid())
    sha1 = None
    try:
        if not(os.path.isdir(tempdir)):
            os.mkdir(tempdir)
        subprocess.run(['flips', '--apply', patchfile, '/usr/local/share/smw.sfc', tempdir+'/test.sfc'], check=True)
        f = open(tempdir+'/test.sfc','rb')
        sha1 = hashlib.sha1()
        while True:
           data = f.read(BUF_SIZE)
           if not data:
               break
           sha1.update(data)
        f.close()
        return sha1.hexdigest()
    finally:
        if os.path.isfile(tempdir+'/test.sfc'):
              os.unlink(tempdir+'/test.sfc')
        os.rmdir(tempdir)
    return None


for fe in os.listdir(".") :
  m = re.match('(\d+)_.*.bps',fe)
  if m:
      sha1 = testpatch_sha1(fe)
      print("NF:" + fe)
      newfile = " ".join(('VLDC13 ' + m.group(1) + ' ' + hashfile[sha1] + '.bps').split(" "))
      print(fe+' (' + sha1 + ')    rename to:' + newfile)
      os.rename(fe,newfile)








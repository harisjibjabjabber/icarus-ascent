import json,struct,sys
def info(p):
    b=open(p,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l])
    ext=j.get('extensions',{}); 
    if 'VRMC_vrm' in ext:
        m=ext['VRMC_vrm']['meta']; ver='1.0'
        lic={k:m.get(k) for k in ['name','authors','licenseUrl','avatarPermission','commercialUsage','allowRedistribution','modification','creditNotation','allowExcessivelySexualUsage','allowAntisocialOrHateUsage','otherLicenseUrl']}
    elif 'VRM' in ext:
        m=ext['VRM']['meta']; ver='0.x'
        lic={k:m.get(k) for k in ['title','author','licenseName','otherPermissionUrl','otherLicenseUrl','allowedUserName','commercialUssageName','sexualUssageName','violentUssageName']}
    else: ver='none'; lic={}
    tris=0
    for me in j['meshes']:
        for pr in me['primitives']:
            if 'indices' in pr: tris+=j['accessors'][pr['indices']]['count']//3
            else: tris+=j['accessors'][pr['attributes']['POSITION']]['count']//3
    print(p, 'VRM',ver,'tris',tris,'mats',len(j.get('materials',[])),'\n  ',json.dumps(lic,ensure_ascii=False))
for p in sys.argv[1:]: info(p)

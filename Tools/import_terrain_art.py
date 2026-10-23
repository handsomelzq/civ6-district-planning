"""Prepare locally decoded strategic-view RGBA PNGs. No dependencies or uploads.

Input is the zero-filter RGBA PNG + provenance manifest from the local BLP probe.
Bottom-layer RGB is made opaque; hill sprites have transparent padding trimmed.
Other sprites retain their original alpha. Never overwrites installed game files.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'

def read_png(data):
    if data[:8] != SIGNATURE:
        raise ValueError('not a PNG')
    offset, compressed, size = 8, bytearray(), None
    while offset < len(data):
        count = struct.unpack_from('>I', data, offset)[0]
        tag = data[offset + 4:offset + 8]
        blob = data[offset + 8:offset + 8 + count]
        crc = struct.unpack_from('>I', data, offset + 8 + count)[0]
        if zlib.crc32(tag + blob) & 0xffffffff != crc:
            raise ValueError('PNG checksum mismatch')
        if tag == b'IHDR':
            w,h,depth,color,compression,filtering,interlace = struct.unpack('>IIBBBBB', blob)
            if (depth,color,compression,filtering,interlace) != (8,6,0,0,0) or not 0 < w*h <= 4096*4096:
                raise ValueError('expected bounded 8-bit RGBA PNG')
            size = (w,h)
        if tag == b'IDAT': compressed.extend(blob)
        offset += count + 12
    if not size: raise ValueError('missing PNG header')
    w,h = size
    raw = zlib.decompress(compressed)
    if len(raw) != (w*4+1)*h: raise ValueError('invalid RGBA rows')
    pixels = bytearray()
    for y in range(h):
        start = y*(w*4+1)
        if raw[start] != 0: raise ValueError('input must come from the zero-filter BLP decoder')
        pixels.extend(raw[start+1:start+1+w*4])
    return w,h,pixels

def encode(w,h,pixels):
    def chunk(tag,blob):
        return struct.pack('>I',len(blob))+tag+blob+struct.pack('>I',zlib.crc32(tag+blob)&0xffffffff)
    rows=b''.join(b'\x00'+pixels[y*w*4:(y+1)*w*4] for y in range(h))
    return SIGNATURE+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')

def prepare(source, manifest, out):
    if out.resolve() == source.resolve(): raise ValueError('output must not overwrite source art')
    prepared=[]
    for item in json.loads(manifest.read_text(encoding='utf8')):
        name=item['name']
        if not re.fullmatch(r'(SV_TerrainHex|SV_Sprites_Hills|SV_TerrainMountain|Features_)[A-Za-z0-9_]+',name):
            raise ValueError('unexpected art name')
        original=(source/(name+'.png')).read_bytes()
        if hashlib.sha256(original).hexdigest()!=item['png_sha256']:
            raise ValueError('source hash mismatch: '+name)
        w,h,pixels=read_png(original)
        adaptation='original RGBA'
        if name.startswith('SV_TerrainHex'):
            pixels[3::4]=bytes([255])*(w*h)
            adaptation='RGB as opaque base; not a recreation of the game shader'
        elif name.startswith('SV_Sprites_Hills'):
            occupied=[i for i,a in enumerate(pixels[3::4]) if a]
            if not occupied: raise ValueError('empty hill sprite')
            x0,x1=min(i%w for i in occupied),max(i%w for i in occupied)+1
            y0,y1=min(i//w for i in occupied),max(i//w for i in occupied)+1
            pixels=bytearray(b''.join(pixels[(y*w+x0)*4:(y*w+x1)*4] for y in range(y0,y1)))
            w,h=x1-x0,y1-y0
            adaptation='trim transparent padding; preserve RGB and alpha'
        data=encode(w,h,pixels)
        prepared.append((name,data,dict(item,prepared_width=w,prepared_height=h,
            prepared_sha256=hashlib.sha256(data).hexdigest(),adaptation=adaptation)))
    # Validate every source before writing any file; a partial import cannot enable the build.
    out.mkdir(parents=True,exist_ok=True)
    for name,data,_ in prepared: (out/(name+'.png')).write_bytes(data)
    (out/'manifest.json').write_text(json.dumps([i for _,_,i in prepared],ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('Prepared %d local terrain textures in %s'%(len(prepared),out))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--out',type=Path,default=Path(__file__).resolve().parent.parent/'web/civ6-terrain')
    args=parser.parse_args()
    prepare(args.source,args.manifest,args.out)

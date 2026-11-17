import json,re,collections
d=json.load(open('art/sprites.json'))
DESK={'#d9c7a8':'#dcb98f','#bfa882':'#c49a68'}
SCR={'#9aa3ad':'#bfe3ea','#7c858f':'#59636f'}
def darken(h,f=.85):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16) for i in (0,2,4)]
    return '#%02x%02x%02x'%(int(r*f),int(g*f),int(b*f))
def info(svg):
    f0=svg.split('of-frame-1')[0]
    rs=re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]+)"',f0)
    skin=[c for x,y,w,h,c in rs if (x,y)==('30','25')][0]
    skind=[c for x,y,w,h,c in rs if (x,y)==('30','45')][0]
    cnt=collections.Counter(c for x,y,w,h,c in rs if int(y)<55 and c not in(skin,skind))
    hair=[c for c,_ in cnt.most_common() if c not in('#3d3226','#8a4b43','#ffffff')][0]
    return hair,skin,skind

ACC={'amatl':['glasses','badge'],'tlahtoani':['mustache','scarf:#7a4a8a'],'tepantli':['glasses_sq'],'tequitl':['headband:#d98a4a'],'atl':['badge'],'teocuitl':['glasses_sq','badge'],'balam':['beard'],'ollin':['earring','headband:#c96a78'],'metztli':['scarf:#9aa3ad'],'nelli':['glasses'],'yollotl':['earring'],'coyolli':['earring:#e0b030','badge:#e0b030'],'tlahtolli':['glasses'],'tochtli':['headband:#4a8ac9'],'legal_archivist':['glasses','scarf:#8a6a4a'],'legal_dof_watchdog':['headband:#d94a4a'],'socrates':['beard'],'antinomia':['glasses_sq'],'estratega':['mustache'],'vinculo':['earring','scarf:#4a9a8a'],'vizumi':['glasses_sq','badge'],'verificador':['glasses'],'mk_cmo':['glasses_sq','scarf:#6e4a9a'],'mk_vig':['beard'],'mk_inf':['headband:#e0903a'],'mk_via':['earring'],'mk_ana':['glasses'],'mk_inv':['mustache'],'mk_com':['scarf:#d96a8a']}
def acc_svg(kinds,hair):
    o=''
    for k in kinds:
        n,_,c=k.partition(':')
        if n=='glasses': o+='<rect x="36" y="27" width="13" height="11" rx="3" fill="rgba(255,255,255,.18)" stroke="#2f2a25" stroke-width="2"/><rect x="52" y="27" width="13" height="11" rx="3" fill="rgba(255,255,255,.18)" stroke="#2f2a25" stroke-width="2"/><rect x="49" y="31" width="3" height="2" fill="#2f2a25"/>'
        if n=='glasses_sq': o+='<rect x="35" y="27" width="14" height="10" fill="rgba(255,255,255,.18)" stroke="#3a3a46" stroke-width="2.5"/><rect x="51" y="27" width="14" height="10" fill="rgba(255,255,255,.18)" stroke="#3a3a46" stroke-width="2.5"/><rect x="49" y="31" width="2" height="2" fill="#3a3a46"/>'
        if n=='beard': o+=f'<rect x="32" y="45" width="36" height="9" fill="{hair}"/><rect x="30" y="38" width="4" height="10" fill="{hair}"/><rect x="66" y="38" width="4" height="10" fill="{hair}"/><rect x="45" y="40" width="10" height="4" fill="#8a4b43"/>'
        if n=='mustache': o+=f'<rect x="41" y="36" width="18" height="4" fill="{hair}"/>'
        if n=='headband': o+=f'<rect x="28" y="18" width="44" height="4" fill="{c or "#d0605a"}"/>'
        if n=='scarf': o+=f'<rect x="28" y="55" width="44" height="6" fill="{c or "#d0605a"}"/><rect x="58" y="60" width="6" height="12" fill="{c or "#d0605a"}"/>'
        if n=='badge': o+=f'<rect x="58" y="64" width="7" height="7" fill="{c or "#d94a4a"}"/><rect x="60" y="66" width="3" height="3" fill="#fff"/>'
        if n=='earring': o+=f'<rect x="24" y="40" width="4" height="6" fill="{c or "#e0b030"}"/><rect x="72" y="40" width="4" height="6" fill="{c or "#e0b030"}"/>'
    return o

def unify(svg,nombre=None,estado_txt=None,hair=None,skin=None,fs=None,legs=True,kinds=()):
    h0,s0,sd0=info(svg)
    m={}
    if hair: m[h0]=hair
    if skin: m[s0]=skin; m[sd0]=darken(skin,.88)
    def rep(c):
        c=c.lower()
        if c in m: return m[c]
        return DESK.get(c) or SCR.get(c) or c
    svg=re.sub(r'fill="(#[0-9a-fA-F]+)"',lambda mo:'fill="%s"'%rep(mo.group(1)),svg)
    # patas del escritorio y soporte del monitor (en ambos cuadros)
    legs_svg='<rect x="10" y="105" width="10" height="10" fill="#9b7550"></rect><rect x="80" y="105" width="10" height="10" fill="#9b7550"></rect><rect x="5" y="100" width="90" height="5" fill="#b58a5a"></rect>'
    svg=svg.replace('<rect x="5" y="100" width="90" height="5" fill="#c49a68"></rect>',legs_svg)
    # marco del monitor: sombra tras la pantalla
    svg=svg.replace('<rect x="35" y="70" width="30" height="5" fill="#bfe3ea"></rect>','<rect x="30" y="65" width="40" height="5" fill="#59636f"></rect><rect x="30" y="70" width="5" height="10" fill="#59636f"></rect><rect x="65" y="70" width="5" height="10" fill="#59636f"></rect><rect x="35" y="70" width="30" height="5" fill="#bfe3ea"></rect>')
    svg=svg.replace('viewBox="0 0 190 150"','viewBox="0 0 190 160"').replace('height="142"','height="152"',1).replace('y="130" text-anchor','y="149" text-anchor')
    if kinds:
        ah=hair or h0
        a=acc_svg(kinds,ah)
        svg=re.sub(r'(<g class="of-frame of-frame-\d">)(.*?)(</g>)',lambda mo:mo.group(1)+mo.group(2)+a+mo.group(3),svg,flags=re.S)
    if nombre:
        fs=fs or (15 if len(nombre)<=13 else 12)
        svg=re.sub(r'(<text [^>]*?)font-size="15"([^>]*>)[^<]*(</text>)',lambda mo:f'{mo.group(1)}font-size="{fs}"{mo.group(2)}{nombre}{mo.group(3)}',svg)
        svg=re.sub(r'aria-label="[^"]*"',f'aria-label="{nombre}"',svg,count=1)
    return svg
SHORT={'legal_archivist':'Archivero','legal_dof_watchdog':'Vigía DOF'}
out={}
for k,v in d.items():
    out[k]={'estado':v['estado'],'svg':unify(v['svg'],SHORT.get(k),kinds=ACC.get(k,()))}
NEW={'socrates':('tochtli','Sócrates','#d8d4cc','#f1dcc2'),'antinomia':('nelli','Antinomia','#d9b25a','#f1dcc2'),'estratega':('tepantli','Estratega','#2b2723','#a9714a'),'vinculo':('balam','Vínculo','#a35a2a','#e6c29a'),'vizumi':('tlahtoani','Vizumi','#3d2a1e','#d9a577'),'verificador':('atl','Verificador','#6b4a2f','#c99468')}
MKB={'cmo':('tlahtoani','CMO','#6e6a73','#e6c29a'),'vig':('amatl','Vigilante','#2f2a25','#d9a577'),'inf':('atl','Informe diario','#1f1f24','#a9714a'),'via':('balam','Vigía 7:30','#c46a3a','#f1dcc2'),'ana':('teocuitl','Analista','#3a2c24','#8f5d3d'),'inv':('yollotl','Investigador','#6b4a2f','#e6c29a'),'com':('tepantli','Comunicaciones','#1f1f24','#f1dcc2')}
for k,(b,n,hc,sc) in NEW.items():
    out[k]={'estado':d[b]['estado'],'svg':unify(d[b]['svg'],n,hair=hc,skin=sc,kinds=ACC.get(k,()))}
for k,(b,n,hc,sc) in MKB.items():
    out['mk_'+k]={'estado':d[b]['estado'],'svg':unify(d[b]['svg'],n,hair=hc,skin=sc,kinds=ACC.get('mk_'+k,()))}
json.dump(out,open('art/sprites_unif.json','w'),ensure_ascii=False)
# hoja de prueba
h='<html><body style="margin:0;background:#f3eee3;display:flex;flex-wrap:wrap;width:1100px">'
for k,v in out.items():
    s=re.sub(r' class="[^"]*"','',v['svg'],count=1)
    h+=f'<div style="width:190px;height:150px">{s.replace("<svg ","<svg width=190 height=150 ",1)}</div>'
open('sheet2.html','w').write(h+'</body></html>')

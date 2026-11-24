#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
struct Fir { std::array<float,1026> h{}; unsigned w=0; float step(float x,const std::array<double,257>& c){h[w]=h[w+513]=x; unsigned n=w+513; double y=0; for(unsigned t=0;t<256;++t)y+=c[t]*(double(h[n-t])+double(h[w+1+t])); y+=c[256]*h[n-256]; w=(w+1)%513; return float(y);} };
int main(){std::array<Fir,2> f{}; std::array<std::array<double,257>,2> c{}; for(unsigned e=0;e<2;++e)for(unsigned t=0;t<257;++t)c[e][t]=(int((t*13+e*7)%31)-15)/8192.0; for(unsigned i=0;i<16384;++i)for(unsigned e=0;e<2;++e){float x=(int((i*17+e*101)%997)-498)/2048.0f; float y=f[e].step(x,c[e]); if(std::fwrite(&y,sizeof y,1,stdout)!=1)return 1;} }

// Detached synthetic PCM only; no audio APIs. Host timing is not Android evidence.
#define main numerical_baseline_main
#include "fir.cpp"
#undef main
#include <algorithm>
#include <chrono>
#include <new>
#include <vector>
static bool tracking=false;
static size_t allocations=0;
void* operator new(size_t n){if(tracking)++allocations;if(void* p=std::malloc(n?n:1))return p;throw std::bad_alloc();}
void* operator new[](size_t n){return ::operator new(n);}
void operator delete(void* p) noexcept{std::free(p);}
void operator delete[](void* p) noexcept{std::free(p);}
void operator delete(void* p,size_t) noexcept{std::free(p);}
void operator delete[](void* p,size_t) noexcept{std::free(p);}
using Frame=std::array<float,2>;
using Coeff=std::array<std::array<double,257>,2>;
static void callback(std::array<Fir,2>& f,const Coeff& c,const Frame* in,Frame* out,size_t n){for(size_t i=0;i<n;++i)for(unsigned e=0;e<2;++e)out[i][e]=f[e].step(in[i][e],c[e]);}
int main(){
 constexpr size_t N=16384; Coeff c{}; std::vector<Frame> in(N),ref(N),out(N);
 for(unsigned e=0;e<2;++e){for(unsigned t=0;t<257;++t)c[e][t]=(int((t*13+e*7)%31)-15)/8192.0;for(unsigned i=0;i<N;++i)in[i][e]=(int((i*17+e*101)%997)-498)/2048.0f;}
 std::array<Fir,2> base{}; callback(base,c,in.data(),ref.data(),N);
 for(size_t block:{64,128,192,256,480}){
  std::array<Fir,2> f{}; std::vector<double> us; us.reserve(2000); allocations=0;size_t misses=0;
  for(size_t offset=0;offset<N;offset+=block){size_t n=std::min(block,N-offset);tracking=true;callback(f,c,in.data()+offset,out.data()+offset,n);tracking=false;}
  if(out!=ref)return 2;
  for(size_t j=0;j<2100;++j){auto start=std::chrono::steady_clock::now();tracking=true;callback(f,c,in.data(),out.data(),block);tracking=false;auto end=std::chrono::steady_clock::now();double elapsed=std::chrono::duration<double,std::micro>(end-start).count();if(j>=100){us.push_back(elapsed);if(elapsed>block*1000000.0/48000)++misses;}}
  std::sort(us.begin(),us.end());std::printf("block=%zu partition=PASS p50=%.3f p95=%.3f p99=%.3f max=%.3f us misses=%zu/2000 ordinary_new=%zu\n",block,us[999],us[1899],us[1979],us.back(),misses,allocations);if(allocations)return 3;
 }
}

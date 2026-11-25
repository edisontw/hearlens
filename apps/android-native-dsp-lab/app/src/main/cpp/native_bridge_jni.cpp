#include <jni.h>

#include "auto_fir_core.hpp"
#include "native_session.hpp"

#include <array>
#include <cstdint>
#include <limits>
#include <sstream>
#include <string>

bool runPortableFixture(std::istream& fixture, std::ostream& result);
int runNativeSessionCheck(std::ostream& result);

namespace {

using namespace hearlens::research;

struct SessionHandle {
  BandBasis basis{};
  std::array<BandTargets, 2> targets{};
  NativeSession session;
  NativeSession::Ticket ticket{};
  std::uint64_t routeStamp = 0;
  bool authorized = false;

  SessionHandle() : session(basis, targets) {}
};

SessionHandle* fromHandle(jlong handle) noexcept {
  return reinterpret_cast<SessionHandle*>(static_cast<std::intptr_t>(handle));
}

jlong toHandle(SessionHandle* handle) noexcept {
  return static_cast<jlong>(reinterpret_cast<std::intptr_t>(handle));
}

bool setUtf8(JNIEnv* env, jstring& output, const std::string& value) {
  output = env->NewStringUTF(value.c_str());
  return output != nullptr;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeVersion(JNIEnv* env,
                                                           jobject) {
  jstring result = nullptr;
  setUtf8(env, result, "detached-native-fir C++17 / synthetic-only");
  return result;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeRunPortableFixture(
    JNIEnv* env, jobject, jbyteArray fixtureBytes) {
  if (fixtureBytes == nullptr) return nullptr;
  const jsize size = env->GetArrayLength(fixtureBytes);
  if (size <= 0) return nullptr;

  std::string fixture(static_cast<std::size_t>(size), '\0');
  env->GetByteArrayRegion(fixtureBytes, 0, size,
                          reinterpret_cast<jbyte*>(fixture.data()));
  if (env->ExceptionCheck()) return nullptr;

  std::istringstream input(fixture,
      std::ios_base::in | std::ios_base::binary);
  std::ostringstream output(std::ios_base::out | std::ios_base::binary);
  if (!runPortableFixture(input, output)) return nullptr;

  const std::string result = output.str();
  if (result.size() >
      static_cast<std::size_t>(std::numeric_limits<jsize>::max())) return nullptr;
  jbyteArray bytes = env->NewByteArray(static_cast<jsize>(result.size()));
  if (bytes == nullptr) return nullptr;
  env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(result.size()),
      reinterpret_cast<const jbyte*>(result.data()));
  return env->ExceptionCheck() ? nullptr : bytes;
}

extern "C" JNIEXPORT jstring JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeRunSessionMatrix(
    JNIEnv* env, jobject) {
  std::ostringstream output;
  if (runNativeSessionCheck(output) != 0) return nullptr;
  jstring result = nullptr;
  setUtf8(env, result, output.str());
  return result;
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeCreateSession(JNIEnv*,
                                                                 jobject) {
  return toHandle(new SessionHandle());
}

extern "C" JNIEXPORT void JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeDestroySession(JNIEnv*,
                                                                  jobject,
                                                                  jlong handle) {
  SessionHandle* session = fromHandle(handle);
  if (session == nullptr) return;
  session->session.invalidate();
  session->authorized = false;
  delete session;
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeGeneration(JNIEnv*, jobject,
                                                              jlong handle) {
  SessionHandle* session = fromHandle(handle);
  return session == nullptr ? -1 : static_cast<jlong>(session->session.generation());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeStartSession(
    JNIEnv*, jobject, jlong handle, jlong expectedGeneration, jlong routeStamp) {
  SessionHandle* session = fromHandle(handle);
  if (session == nullptr || expectedGeneration < 0 || routeStamp <= 0) {
    return JNI_FALSE;
  }
  session->ticket = session->session.authorizeSynthetic(
      static_cast<std::uint64_t>(expectedGeneration),
      static_cast<std::uint64_t>(routeStamp), true);
  session->routeStamp = static_cast<std::uint64_t>(routeStamp);
  session->authorized = session->session.isCurrent(session->ticket);
  return session->authorized ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeSessionIsCurrent(
    JNIEnv*, jobject, jlong handle) {
  SessionHandle* session = fromHandle(handle);
  return session != nullptr && session->authorized &&
      session->session.isCurrent(session->ticket) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeProcessSynthetic(
    JNIEnv* env, jobject, jlong handle, jfloatArray pcm) {
  SessionHandle* session = fromHandle(handle);
  if (session == nullptr || !session->authorized ||
      !session->session.isCurrent(session->ticket)) return 0;

  const jsize count = pcm == nullptr ? 0 : env->GetArrayLength(pcm);
  std::array<float, kMaximumCallbackFrames * 2> samples{};
  if (count > 0 && static_cast<std::size_t>(count) <= samples.size()) {
    env->GetFloatArrayRegion(pcm, 0, count, samples.data());
    if (env->ExceptionCheck()) return 0;
  }
  const float* input = pcm == nullptr ? nullptr : samples.data();
  const auto candidate = session->session.process(
      session->ticket, session->routeStamp, input,
      count < 0 ? 0 : static_cast<std::size_t>(count),
      NativeSession::Clock::time_point::max());
  if (!session->session.isCurrent(session->ticket)) {
    session->authorized = false;
    return 0;
  }
  return static_cast<jint>(candidate.frames);
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeInvalidateSession(
    JNIEnv*, jobject, jlong handle) {
  SessionHandle* session = fromHandle(handle);
  if (session == nullptr) return -1;
  session->session.invalidate();
  session->authorized = false;
  return static_cast<jlong>(session->session.generation());
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeRouteChanged(
    JNIEnv*, jobject, jlong handle, jlong routeStamp) {
  SessionHandle* session = fromHandle(handle);
  if (session == nullptr) return -1;
  session->session.invalidate();
  session->authorized = false;
  session->routeStamp = routeStamp > 0 ? static_cast<std::uint64_t>(routeStamp) : 0;
  return static_cast<jlong>(session->session.generation());
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_hearlens_nativedsplab_NativeBridge_nativeQueueOverflow(
    JNIEnv*, jobject, jlong handle) {
  SessionHandle* session = fromHandle(handle);
  if (session == nullptr) return -1;
  session->session.invalidate(session->ticket);
  session->authorized = false;
  return static_cast<jlong>(session->session.generation());
}

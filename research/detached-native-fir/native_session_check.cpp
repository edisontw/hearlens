#include "native_session.hpp"

#include <cassert>
#include <iostream>
#include <thread>

namespace {
using namespace hearlens::research;
using Clock = NativeSession::Clock;
constexpr auto deadline = Clock::time_point::max();
constexpr std::uint64_t route = 42;
using Buffer = std::array<float, 256>;

std::atomic<bool> atFinish{false};
std::atomic<bool> finishAllowed{false};
unsigned clockReads = 0;

auto pauseAtFinish() noexcept -> Clock::time_point {
  if (++clockReads == 2) {
    atFinish.store(true);
    while (!finishAllowed.load()) std::this_thread::yield();
  }
  return {};
}

auto overrunAtFinish() noexcept -> Clock::time_point {
  return ++clockReads == 2 ? deadline : Clock::time_point{};
}

void checkInFlight(NativeSession& session, const Buffer& pcm, bool overflow) {
  const auto ticket = session.authorizeSynthetic(session.generation(), route, true);
  assert(session.isCurrent(session.process(ticket, route, pcm.data(), pcm.size(), deadline)));
  atFinish = false;
  finishAllowed = false;
  clockReads = 0;
  NativeSession::Candidate stale;
  std::thread callback([&] {
    stale = session.process(ticket, route, pcm.data(), pcm.size(), deadline, pauseAtFinish);
  });
  while (!atFinish.load()) std::this_thread::yield();

  if (overflow) {
    assert(session.process(ticket, route, pcm.data(), pcm.size(), deadline).frames == 0);
  } else {
    session.invalidate();
  }
  const auto fresh = session.authorizeSynthetic(session.generation(), route, true);
  finishAllowed = true;
  callback.join();
  assert(stale.frames == 0);
  session.invalidate(ticket);
  assert(session.isCurrent(session.process(fresh, route, pcm.data(), pcm.size(), deadline)));
  session.invalidate();
}

void stress(NativeSession& session, const Buffer& pcm) {
  std::atomic<unsigned> ready{0};
  std::atomic<unsigned> completed{0};
  NativeSession::Ticket ticket;
  std::thread callback([&] {
    for (unsigned i = 1; i <= 2000; ++i) {
      while (ready.load() != i) std::this_thread::yield();
      const auto localTicket = ticket;
      const auto result = session.process(localTicket, route, pcm.data(), pcm.size(), deadline);
      completed.store(i * 2 - 1);
      while (ready.load() == i) std::this_thread::yield();
      assert(!session.isCurrent(result));
      completed.store(i * 2);
    }
  });
  for (unsigned i = 1; i <= 2000; ++i) {
    ticket = session.authorizeSynthetic(session.generation(), route, true);
    ready = i;
    session.invalidate(ticket);
    while (completed.load() != i * 2 - 1) std::this_thread::yield();
    ready = 0;
    while (completed.load() != i * 2) std::this_thread::yield();
  }
  callback.join();
}
}  // namespace

int runNativeSessionCheck(std::ostream& result) {
  BandBasis basis{};
  basis[0][kUniqueTapCount - 1] = 1.0;
  const std::array<BandTargets, 2> targets{};
  NativeSession session(basis, targets);
  NativeSession invalid(basis, targets, 0.0);
  Buffer pcm{};
  pcm.fill(0.02F);

  auto process = [&](const auto& ticket, std::uint64_t stamp = route) {
    return session.process(ticket, stamp, pcm.data(), pcm.size(), deadline);
  };
  const auto muted = session.generation();
  assert(process(NativeSession::Ticket{}).frames == 0);
  assert(process(session.authorizeSynthetic(muted, 0, true)).frames == 0);
  assert(process(session.authorizeSynthetic(muted, route, false)).frames == 0);
  assert(invalid.process(invalid.authorizeSynthetic(0, route, true),
                         route, pcm.data(), pcm.size(), deadline).frames == 0);
  auto arm = [&] { return session.authorizeSynthetic(session.generation(), route, true); };

  auto ticket = arm();
  assert(session.isCurrent(ticket));
  const auto candidate = process(ticket);
  assert(candidate.frames == 128 && session.isCurrent(candidate));
  assert(invalid.process(ticket, route, pcm.data(), pcm.size(), deadline).frames == 0);
  session.invalidate(); // stop/reset/settings change
  assert(!session.isCurrent(ticket));
  assert(!session.isCurrent(candidate) && process(ticket).frames == 0);
  assert(process(session.authorizeSynthetic(muted, route, true)).frames == 0);

  for (const auto changed : {std::uint64_t{0}, route + 1}) {
    ticket = arm();
    assert(process(ticket, changed).frames == 0);
    assert(process(ticket).frames == 0);
  }
  ticket = arm();
  session.invalidate(ticket); // disconnect or upstream queue overflow
  assert(process(ticket).frames == 0);

  for (const auto badInput : {std::numeric_limits<float>::quiet_NaN(),
                              std::numeric_limits<float>::infinity(), 17.0F}) {
    for (const auto ear : {0, 1}) {
      ticket = arm();
      pcm[ear] = badInput;
      assert(process(ticket).frames == 0);
      pcm[ear] = 0.02F;
      assert(process(ticket).frames == 0);
    }
  }
  for (const auto badLength : {std::size_t{0}, std::size_t{3}, 2 * kMaximumCallbackFrames + 2}) {
    ticket = arm();
    assert(session.process(ticket, route, pcm.data(), badLength, deadline).frames == 0);
    assert(process(ticket).frames == 0);
  }
  ticket = arm();
  assert(session.process(ticket, route, nullptr, pcm.size(), deadline).frames == 0);
  assert(process(ticket).frames == 0);
  ticket = arm();
  assert(session.process(ticket, route, pcm.data(), pcm.size(), {}).frames == 0);
  assert(process(ticket).frames == 0);
  clockReads = 0;
  ticket = arm();
  assert(session.process(ticket, route, pcm.data(), pcm.size(), deadline,
                         overrunAtFinish).frames == 0);
  assert(clockReads == 2 && process(ticket).frames == 0);

  checkInFlight(session, pcm, false);
  checkInFlight(session, pcm, true);
  stress(session, pcm);
  result << "Native synthetic session fault matrix, two in-flight invalidations, "
            "and 2000 concurrent invalidations PASS\n";
  return 0;
}

#ifndef HEARLENS_ANDROID_JNI
int main() {
  return runNativeSessionCheck(std::cout);
}
#endif

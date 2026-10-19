package org.hearlens.acousticbench;

/**
 * Digital AudioTrack playback-head accounting, independent of Android APIs.
 * "Drained" proves only that Android's playback cursor consumed submitted PCM;
 * it does NOT prove that the Bluetooth receiver emitted acoustic energy.
 */
public final class BenchPlaybackProgress {
    public static final long MAX_QUEUED_FRAMES = 9_600; // 200 ms at 48 kHz
    public static final long STALL_MS = 1_800;
    public static final long DRAIN_TIMEOUT_MS = 3_500;

    private long submitted;
    private long played;
    private long lastProgressMs;
    private long drainStartedMs = -1;

    public BenchPlaybackProgress(long primedFrames,long initialPlayed,long nowMs) {
        if(primedFrames<0 || initialPlayed<0 || initialPlayed>primedFrames)
            throw new IllegalArgumentException("invalid_initial_frames");
        submitted=primedFrames;
        played=initialPlayed;
        lastProgressMs=nowMs;
    }
    public void accepted(long frames) {
        if(frames<0)throw new IllegalArgumentException("negative_write");
        submitted+=frames;
    }
    public void observe(long playbackHeadFrames,long nowMs) {
        if(playbackHeadFrames<played || playbackHeadFrames>submitted)
            throw new IllegalStateException("playback_head_out_of_range");
        if(playbackHeadFrames>played)lastProgressMs=nowMs;
        played=playbackHeadFrames;
    }
    public boolean canQueue() {
        return submitted-played < MAX_QUEUED_FRAMES;
    }
    public boolean stalled(long nowMs) {
        return submitted>played && nowMs-lastProgressMs>STALL_MS;
    }
    public void startDrain(long nowMs) {
        if(drainStartedMs>=0)throw new IllegalStateException("already_draining");
        drainStartedMs=nowMs;
    }
    public boolean drained() {
        return drainStartedMs>=0 && played==submitted;
    }
    public boolean drainTimedOut(long nowMs) {
        return drainStartedMs>=0 && !drained() &&
            nowMs-drainStartedMs>DRAIN_TIMEOUT_MS;
    }
    public long submittedFrames(){return submitted;}
    public long playedFrames(){return played;}
    public long queuedFrames(){return submitted-played;}
}

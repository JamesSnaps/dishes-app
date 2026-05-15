"use client";

import { useEffect, useRef, useCallback } from "react";
import { toast } from "@/hooks/use-toast";

const STORAGE_KEY = "dishes-pending-image-jobs";
const POLL_INTERVAL = 3000;

export interface PendingImageJob {
  jobId: string;
  recipeId: string;
  recipeTitle: string;
}

function readJobs(): PendingImageJob[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeJobs(jobs: PendingImageJob[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

export function addPendingImageJob(job: PendingImageJob) {
  const jobs = readJobs();
  if (!jobs.find((j) => j.jobId === job.jobId)) {
    jobs.push(job);
    writeJobs(jobs);
  }
  window.dispatchEvent(new Event("dishes-jobs-changed"));
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollOnce = useCallback(async () => {
    const jobs = readJobs();
    if (jobs.length === 0) return;

    await Promise.all(
      jobs.map(async (job) => {
        try {
          const res = await fetch(`/api/jobs/${job.jobId}`);
          if (!res.ok) return;
          const data: { status: string; error?: string } = await res.json();

          if (data.status === "done") {
            writeJobs(readJobs().filter((j) => j.jobId !== job.jobId));
            toast({
              title: "Image ready",
              description: `Photo generated for "${job.recipeTitle}"`,
            });
            window.dispatchEvent(new Event("dishes-notification-added"));
          } else if (data.status === "failed") {
            writeJobs(readJobs().filter((j) => j.jobId !== job.jobId));
            toast({
              title: "Image generation failed",
              description:
                data.error ?? `Couldn't generate photo for "${job.recipeTitle}"`,
              variant: "destructive",
            });
          }
        } catch {
          // network blip — will retry next interval
        }
      })
    );
  }, []);

  useEffect(() => {
    pollOnce();
    intervalRef.current = setInterval(pollOnce, POLL_INTERVAL);

    const onJobsChanged = () => pollOnce();
    window.addEventListener("dishes-jobs-changed", onJobsChanged);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("dishes-jobs-changed", onJobsChanged);
    };
  }, [pollOnce]);

  return <>{children}</>;
}

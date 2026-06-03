"use client";

import { Loader2, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AttackRunButtonProps = {
  loading: boolean;
  onClick: () => void;
  label: string;
  className?: string;
};

/** Continuous centered shake so visitors notice the primary action. */
export function AttackRunButton({ loading, onClick, label, className }: AttackRunButtonProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={cn("relative shrink-0", className)}
      style={{ transformOrigin: "center center" }}
      animate={
        loading || reducedMotion
          ? { x: 0, rotate: 0 }
          : {
              x: [0, -5, 5, -5, 5, 0],
              rotate: [0, -0.8, 0.8, -0.8, 0.8, 0],
            }
      }
      transition={{
        duration: 0.45,
        repeat: Infinity,
        repeatDelay: 0.6,
        ease: "easeInOut",
      }}
      whileHover={reducedMotion ? undefined : { scale: 1.05 }}
      whileTap={reducedMotion ? undefined : { scale: 0.95 }}
    >
      <Button
        type="button"
        disabled={loading}
        onClick={onClick}
        className="relative h-9 gap-2 px-4 shadow-md"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {label}
      </Button>
    </motion.div>
  );
}

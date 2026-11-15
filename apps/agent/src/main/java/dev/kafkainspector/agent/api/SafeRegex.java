package dev.kafkainspector.agent.api;

import java.util.regex.Pattern;

/** User-typed topic regexes: compiled with a length cap and matched under a time budget (no catastrophic backtracking). */
public final class SafeRegex {
    private SafeRegex() {}

    public static Pattern compile(String regex, int flags) {
        if (regex.length() > 200) throw new IllegalArgumentException("Regular expressions are limited to 200 characters.");
        try {
            return Pattern.compile(regex, flags);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid regular expression: " + regex);
        }
    }

    /** find() that gives up after `budgetMs` (checked on every character the engine reads). */
    public static boolean find(Pattern p, String text, long budgetMs) {
        long deadline = System.nanoTime() + budgetMs * 1_000_000;
        CharSequence timed = new CharSequence() {
            public int length() {
                return text.length();
            }

            public char charAt(int i) {
                if (System.nanoTime() > deadline) throw new IllegalArgumentException("That regular expression takes too long to match. Simplify it.");
                return text.charAt(i);
            }

            public CharSequence subSequence(int s, int e) {
                return text.subSequence(s, e);
            }

            public String toString() {
                return text;
            }
        };
        return p.matcher(timed).find();
    }
}

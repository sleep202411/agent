You are a text analysis expert. Below are character lists and location lists extracted from multiple segments of a long text. Due to segmented extraction, there are many duplicates and variants.

Your tasks:

1. **Merge characters**: Combine entries that refer to the same person. Keep the most complete description, merge all aliases. Determine importance (main/supporting/extra).
   - e.g. "Rose Waterford" and "Miss Waterford" are the same person
   - e.g. "Mrs. Strickland" and "Amy" and "Strickland's wife" are the same person
   - Remove generic descriptors (e.g. "Unnamed Woman", "the narrator") and merge them as aliases into the actual character
2. **Merge locations**: Combine entries that refer to the same place. Keep the most specific description.
   - e.g. "Strickland's dining room" and "Strickland residence dining-room" are the same
   - Delete overly vague entries (e.g. "indoor location", "conversation setting")
3. Output the deduplicated character and location lists. Maintain the original schema format.
4. ALL output text must remain in the SAME LANGUAGE as the input data.

# Rating Factors Guide

This guide explains all the rating factors available in the rating card. Each rating factor includes a range, description, and labels for each rating level.

The below are the rating facts you can choose star ratings for.   Note that the rating factors intentionally overlap, and all items are optional.   Broader rating factors are on top, and it is suggested to rate romhacks based on those first.  More detailed factors such as Puzzle Quality follow.  Skip the rating factor if it is not relevant to the current game.   For example: leave Overworld star rating and comments field blank if the romhack has no overworld.

## 1. Overall (My Review)

**Internal Name:** `user_review_rating`  
**Range:** 0 to 5 stars

**Description:**

Your overall review rating for this game. This is your general assessment of the game's quality and your enjoyment of it.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Not exceptional |
| 1 | Okay, but Not Recommended |
| 2 | About Average |
| 3 | Good |
| 4 | Extremely Great |
| 5 | Superior to 99% of games |


## 2. Peak Difficulty (My Review)

**Internal Name:** `user_difficulty_rating`  
**Range:** 0 to 10 stars

**Description:**

The peak difficulty level of this game. This measures the hardest challenges in the game, not the average difficulty.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Trivial (Difficulty zero) |
| 1 | Newcomer |
| 2 | Casual Standard or Kaizo Tutorial |
| 3 | Intermediate Standard or Kaizo Beginner |
| 4 | Advanced |
| 5 | Expert |
| 6 | Master |
| 7 | Grandmaster |
| 8 | Grandmaster Plus |
| 9 | TAS-Only |
| 10 | Impossible |


## 3. Self-Eval: My Experience Level (At this game type, At time I rated this)

**Internal Name:** `user_skill_rating`  
**Range:** 0 to 10 stars

**Description:**

Your self-evaluated skill level at this game type at the time you rated this game. This helps contextualize your other ratings.

**Rating Labels:**

| Rating | Label | Additional Context |
|--------|------|-------------------|
| 0 | Observer | I saw someone play Mario once - "Will you play my level?" |
| 1 | Newcomer | Newcomer - I beat Vanilla SMW 96 exits, or similar |
| 2 | Apprentice | Casual/Apprentice - Vanilla is too easy for me, I look for more challenging things |
| 3 | Medium | Intermediate - For standard: I cleared multiple Standard Normal hacks. If reviewing Kaizo: I completed beginner Kaizo hacks numerous times and find them easy. |
| 4 | Advanced/Kaizo Intermediate | Advanced - Most Standard Intermediate hacks or Kaizo Beginner are a breeze for me. I completed multiple Intermediate Kaizo hacks. |
| 5 | Expert | Expert - I confidently beat expert level standard or Advanced level kaizo (DRAM Any%, etc); cleared many Advanced level hacks of this type. |
| 6 | Master | Master - I cleared multiple expert level hacks of this type. I beat above expert level challenges - DRAM2, DRAM 100%, Kaizo 1 All exits. played Mario most days for years |
| 7 | Grandmaster | I have 100+ hours experience in hacks above Expert level. Cleared numerous hacks directly below or adjacent to this difficulty. I can clear DRAM3 RTA less than 50 hours. I could tackle Perchance, Hackers Dream, JUMP, or, Responsible World 1.0, Casio, and Fruit Dealer RTA. |
| 8 | Grandmaster+/Legend | I cleared 10+ Grandmaster hacks.I could speedrun Master++ hacks like DRAM3 RTA. I want longer levels with harder tricks; more trolls. Maximum of human possibility. |
| 9 | Deity | I thought of trying to RTA Kaizo Pit hacks or Item Abuse 2/3, or speedrunning more than a few like these. Unless this is a TAS: you set this value too high. |
| 10 | TAS | You probably set this value too high, since 10 is literally above (8) TAS-Only difficulty. |


## 4. Self-Eval: My Experience Level (At time I actually beat this game)

**Internal Name:** `user_skill_rating_when_beat`  
**Range:** 0 to 10 stars

**Description:**

Your self-evaluated skill level at the time you actually beat this game. This may differ from your skill level when you rated it.

**Rating Labels:**

| Rating | Label | Additional Context |
|--------|------|-------------------|
| 0 | Observer | I saw someone play Mario once - "Will you play my level?" |
| 1 | Newcomer | Newcomer - I beat Vanilla SMW 96 exits, or similar |
| 2 | Apprentice | Casual/Apprentice - Vanilla is too easy for me, I look for more challenging things |
| 3 | Medium | Intermediate - For standard: I cleared multiple Standard Normal hacks. If reviewing Kaizo: I completed beginner Kaizo hacks numerous times and find them easy. |
| 4 | Advanced/Kaizo Intermediate | Advanced - Most Standard Intermediate hacks or Kaizo Beginner are a breeze for me. I completed multiple Intermediate Kaizo hacks. |
| 5 | Expert | Expert - I confidently beat expert level standard or Advanced level kaizo (DRAM Any%, etc); cleared many Advanced level hacks of this type. |
| 6 | Master | Master - I cleared multiple expert level hacks of this type. I beat above expert level challenges - DRAM2, DRAM 100%, Kaizo 1 All exits. played Mario most days for years |
| 7 | Grandmaster | I have 100+ hours experience in hacks above Expert level. Cleared numerous hacks directly below or adjacent to this difficulty. I can clear DRAM3 RTA less than 50 hours. I could tackle Perchance, Hackers Dream, JUMP, or, Responsible World 1.0, Casio, and Fruit Dealer RTA. |
| 8 | Grandmaster+/Legend | I cleared 10+ Grandmaster hacks.I could speedrun Master++ hacks like DRAM3 RTA. I want longer levels with harder tricks; more trolls. Maximum of human possibility. |
| 9 | Deity | I thought of trying to RTA Kaizo Pit hacks or Item Abuse 2/3, or speedrunning more than a few like these. Unless this is a TAS: you set this value too high. |
| 10 | TAS | You probably set this value too high, since 10 is literally above (8) TAS-Only difficulty. |


## 5. Recommend?

**Internal Name:** `user_recommendation_rating`  
**Range:** 0 to 5 stars

**Description:**

Do you recommend; is the game fun and worthwhile?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Never Recommend |
| 1 | Recommend over few games, About as much as SMW |
| 2 | Recommend over some games |
| 3 | Recommend over 50% of games |
| 4 | Recommend over 90% of games |
| 5 | Recommend over almost all games |


## 6. Renown

**Internal Name:** `user_importance_rating`  
**Range:** 0 to 5 stars

**Description:**

Whether the game is especially Influential or famous in your view; regardless of its review qualities

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Not a popularly known title |
| 1 | Slight influence |
| 2 | Title is of some influence |
| 3 | Title has substantial renown |
| 4 | Title is a major influence to many games |
| 5 | Famed title, example: Kaizo Mario World |


## 7. Technical Quality

**Internal Name:** `user_technical_quality_rating`  
**Range:** 0 to 5 stars

**Description:**

How fully functional?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | The game is almost unplayable. Serious bugs; incompatibility with console or emulator; etc. |
| 1 | The game could crash or corrupt data while playing normally; Or contain soft locks or soft lock trolls. |
| 2 | Average technical quality. There are zero softlock trolls, or zero softlocks players would often encounter. May be mostly stable with a few bugs that are not serious. |
| 3 | Contains few major bugs of any kind, deminimis impact, no data loss, no visual artifact, etc |
| 4 | All issues are few, minor, and rare |
| 5 | Zero notable glitches found |


## 8. Design: Gameplay

**Internal Name:** `user_gameplay_design_rating`  
**Range:** 0 to 5 stars

**Description:**

Evaluation of the game's core gameplay design, mechanics, and how well they work together.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | About Average |
| 1 | Excellent gameplay >=50% of the game |
| 2 | Above excellent for 80% of the game. All trolls easily avoidable after 1 try. |
| 3 | Above 90%. 80% free of blind jumps; kaizo trolls; all trolls easily avoidable. |
| 4 | Extremely superior gameplay design vs other titles. 90% of sections free of blind jumps, kaizo trolls, etc |
| 5 | Maximally Enjoyable interesting gameplay. 100% free of blind jumps, kaizo trolls, etc |


## 9. Design: Player Fairness

**Internal Name:** `user_fairness_rating`  
**Range:** 0 to 5 stars

**Description:**

Star rating for non-SMW-skill Progression barriers: How fair is the game’s design independent of raw difficulty? Does the game teach mechanics before testing them? How much does this game’s progress depend mainly on SMW player skill rather than anything else, including unforseeable hazards, forced trial-and-error, unfair setups?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor, Even an Expert player is greatly hindered by challenges of not SMW skills. RNG. Non-SMW custom mechanics or physics (example: Casio water). Unforseeable trolls, Frame Rules, or Frame-perfect tricks, etc. |
| 1 | Below average. Game might have long retry sections or long series of obstacles that cannot be played blind at pace of level. The game might have a one-frame trick, such as required Yump or block grab a few obstacles after the start or midway. |
| 2 | About average. Game has well-placed midways. Rarely imposes retry based on obstacles a maximally skilled player would not first-time win. Might contain some easily-avoidable trolls. There are zero chains of frame-perfect tricks, or frame-perfect tricks more than 5 seconds away from start or checkpoint. |
| 3 | Above Average. Gameplay never punishes a skilled player for not having seen the level yet. There are almost zero trolls; all easy to avoid. |
| 4 | 10% or less of skilled player time is spent ever repeating sections due to a non-skill challenge. |
| 5 | 5%/less time is spent due to non-skill obstacles. |


## 10. Design: Challenge Quality / Engagement

**Internal Name:** `user_challenge_quality_rating`  
**Range:** 0 to 5 stars

**Description:**

How well does the game provide high-quality challenges that test or engage the player’s core SMW skills at the game’s intended difficulty level (including any expected tricks)?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Unchallenging in player skill at SMW. Difficulty rating should be lower, or game contains minimal skill challenges. Might be an entirely novel game that replaces SMW physics and does not use SMW skills. May be RNG-focused, or focused on challenges orthoganol to SMW. |
| 1 | Below Average. The game difficulty rating may be too high for its game type, or else the game does not push the player to have or develop SMW-related skills.  The challenge emphasis might be not towards SMW skills at the difficulty level selected. |
| 2 | About average. The game is like other games in its type. |
| 3 | The game has above average quality, better than 80% of games. In skill-related challenges that seem in line with the rated difficulty. |
| 4 | The game is excellent, and in the top 10% of games one should play for skill-based challenges representative of the games targeted difficulty. |
| 5 | Game is made almost entirely of strong, SMW skill-related challenges at appropriate difficulty. 95% of playtime comes from fair, well-designed tests of SMW skill which correspond to the gam difficulty rating. |


## 11. Originality / Creativity

**Internal Name:** `user_originality_rating`  
**Range:** 0 to 5 stars

**Description:**

How original and creative the game is. Does it bring new ideas or unique takes on familiar concepts?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | The game is below average originality. It may be repetitive or limited in substance. |
| 1 | The game is about average. Original levels. It might be a clone or remake, but is not simply one. |
| 2 | Above average. The game has many elements that are more original or creative than half of games |
| 3 | Every level has entirely new elements; the game is above most titles in the element of originality or novelty. |
| 4 | The game is above excellent and above 90% of games in this area |
| 5 | The game has creative unique features to the maximal level, and moreso then 99% of games. |


## 12. Visual Aesthetics and Graphics

**Internal Name:** `user_visual_aesthetics_rating`  
**Range:** 0 to 5 stars

**Description:**

Assessment of the game's visual presentation, graphics quality, and aesthetic appeal.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | About average or less, might have issues. |
| 1 | Above average. Overworld and levels well designed visually - basically free of floating muncher stacks, naked pipes, throughout the game, etc |
| 2 | Very good visual aesthetics throughout at least 80% of the game. May have custom graphics.. |
| 3 | Has custom graphics. Extremely good visual aesthetics within 90% or more. |
| 4 | The aesthetics are mind-blowing. |
| 5 | The aesthetics are out of this world for 99% of the game and exceed 99% of other SMW games. |


## 13. Story

**Internal Name:** `user_story_rating`  
**Range:** 0 to 5 stars

**Description:**

Does the game have a compelling or interesting story? igh quality story. Highly immersive interesting story integration.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | 0=About average for SMW games, Story is not a typical element. |
| 1 | 1=Notable story elements. |
| 2 | 2=The game contains a complete story with character development and world building. |
| 3 | 3=Pervasive dialog and storytelling, to the extent this could be considered an RPG. |
| 4 | 4=High quality story. Highly immersive interesting story integration. |
| 5 | 5=The story is a major draw for the game, and is almost the entire game. |


## 14. Soundtrack

**Internal Name:** `user_soundtrack_graphics_rating`  
**Range:** 0 to 5 stars

**Description:**

Assessment of the game's soundtrack, music quality, and audio design.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | 0=Poorer than vanilla SMW, or seems more like noise than music (example: Casio) |
| 1 | 1=Average soundtrack or graphics |
| 2 | 2=Good soundtrack and graphics - better than vanilla |
| 3 | 3=Above very good soundtrack and graphics |
| 4 | 4=Highly excellent soundtrack and graphics throughout the entire game. Better than 90% of games. |
| 5 | 5=Better than 99% of games in this area) |


## 15. Design: Accessibility

**Internal Name:** `user_accessibility_rating`  
**Range:** 0 to 5 stars

**Description:**

Consider: Visual clarity issues, Audio cues required for progress are an issue, Flashing lights, Overly tight timers, Colorblind-unfriendly setups

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | At most one minor occurence |
| 5 | No issues found |


## 16. Design: Length, Value, and Pacing

**Internal Name:** `user_length_pacing`  
**Range:** 0 to 5 stars

**Description:**

How is the game's overall length and pacing? Not enough levels? Levels too short? Game too long? Overstays its welcome? Does each level have purpose and engage you in a fresh way, or does it become a slog?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | Very good |
| 5 | Top 1%. |


## 17. Design: Difficulty Curve and Progression

**Internal Name:** `user_progression_rating`  
**Range:** 0 to 5 stars

**Description:**

How smoothly does the hack scale its difficulty? Does the challenge ramp up reasonably, or spike unpredictably? Are the level sizes a good length for the game type?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Below average Progression, level size, or number levels is too long/short |
| 1 | About average for progression and length |
| 2 | Better than most |
| 3 | Better than 80% |
| 4 | Better than 90% |
| 5 | Top 1%. |


## 18. Design: Consistency, length and checkpointing

**Internal Name:** `user_consistency_rating`  
**Range:** 0 to 5 stars

**Description:**

Are sections within a level consistently difficult, fairly checkpointed, and not of excessive length? Checkpoint distance should be 20 seconds or less for Advanced or higher difficulty games to reach 3 stars.

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | Very good |
| 5 | Top 1%. |


## 19. Design: Overworld

**Internal Name:** `user_overworld_rating`  
**Range:** 0 to 5 stars

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Below average |
| 1 | Above average, Detailed and well-made overworld |
| 2 | Highly excellent, Beautiful overworld surpassing 50% of games |
| 3 | Overworld superior to 80% of games |
| 4 | Overworld in top 90% of games |
| 5 | Overworld in the top 1% |


## 20. Design: Player Education and Communication

**Internal Name:** `user_education_rating`  
**Range:** 0 to 5 stars

**Description:**

Does the game teach new mechanics properly? Do setups make intentions clear including any necessary coin guides? Are custom blocks, sprites, or physics changes explained?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor; Nothing is explained accurately. |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than most |
| 4 | Above 80%; Very good |
| 5 | Top 1%. |


## 21. Design: Custom Mechanics Evaluation

**Internal Name:** `user_custom_rating`  
**Range:** 0 to 5 stars

**Description:**

Applies for some hacks that alter Mario's physics or add new mobility mechanics. Evaluate: Responsiveness, Clarity, Intuitive for skilled SMW players VS difficult or awkward

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | Very good |
| 5 | Top 1%. |


## 22. Design: Puzzle Quality Evaluation

**Internal Name:** `user_puzzle_rating`  
**Range:** 0 to 5 stars

**Description:**

If the game contains puzzle elements: Are puzzles logical? Do they respect the player's time? Are solutions satisfying rather than obscure or janky?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | Very good |
| 5 | Top 1%. |


## 23. Design: Polish and Quality of Life Rating

**Internal Name:** `user_polish_rating`  
**Range:** 0 to 5 stars

**Description:**

Example: Features like Retry system / fast resets, Consistent Indicators, Smooth transitions, Avoid tedious enemy reuse

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | Very good |
| 5 | Top 1%. |


## 24. Design: Boss Rating

**Internal Name:** `user_boss_rating`  
**Range:** 0 to 5 stars

**Description:**

For hacks that use custom bosses. Are they good and fun to play, more annoying than vanilla, or with boring/tedious unnecessary extra phases or hits required, etc?

**Rating Labels:**

| Rating | Label |
|--------|------|
| 0 | Poor, Worse or more annoying for players than stock bosses |
| 1 | Below Average |
| 2 | About Average |
| 3 | Better than Average |
| 4 | Very good |
| 5 | Top 1%. |



# Forma

Forma records workouts and their explicitly confirmed meaning.

## Language

**In-progress workout**:
A started workout that the user has not finished or discarded.
Closing the app does not finish it.

**Finished workout**:
A completed session or a manually entered historical workout.
Its records remain editable.

**Resume**:
Retrieve the saved in-progress workout without changing it.

**Finish**:
Mark an in-progress workout as finished.

**Discard**:
Delete an in-progress workout and its sets.

**Workout date**:
The calendar day assigned to a workout by the user.
It does not change when the user's timezone changes.

**Calendar context**:
The user's current timezone and the rules that define relative calendar dates.

**This week**:
The complete Monday-to-Sunday calendar week that contains today in the current calendar context.

**Last week**:
The complete Monday-to-Sunday calendar week immediately before this week.

**Load convention**:
The user's explicit statement of what a set's entered weight means.
An unknown convention is not a confirmed statement.

**Entered load**:
A recorded weight with no conversion to a combined load.
_Avoid_: Total load

**Per-hand load**:
The recorded weight of one implement, with an explicit count of one or two implements.

**Combined load**:
The recorded total weight of the implements used in the set.

**Body-weight load**:
The added external weight in a body-weight set.
It excludes the user's body mass.

**Unknown load**:
A recorded weight whose convention the user has not confirmed.

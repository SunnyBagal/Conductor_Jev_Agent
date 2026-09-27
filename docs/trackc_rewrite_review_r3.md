# Track C rewrite review: r3 (two-stage)

Stage 1 `claude-sonnet-4-6` (facts), Stage 2 `claude-sonnet-4-6` (from facts only), judge `claude-opus-5-5` j1 (validated: 8/8 fix leaks, 38/40 agreement).

**Criterion 2 (judge flags under 10% of rewrites, at most 19):** 86/200 not clean, so **FAIL**.
- Rewrite labels: clean 114, cause_hint 37, fix_leak 26, missing_repro 14, location_hint 9.
- Stage 1 facts labels: clean 143, fix_leak 23, location_hint 22, cause_hint 12. **Leaks already start in Stage 1.**
- By variant: terse: 23/50 not clean; typo: 11/49 not clean; file_mention: 22/50 not clean; rambly: 30/51 not clean.
- Rewrites naming something not in the facts: 22. Typo variant with edits applied in code: 49/49.

## Fresh random 15 (new seed)

### 1. `django__django-15629`, variant **file_mention**, judge: rewrite **clean** / facts **clean**

> Foreign key columns referencing a primary key with `db_collation` don't get the `COLLATE` clause in the generated `ALTER TABLE` SQL, which causes the `ADD CONSTRAINT` to fail in MySQL. The FK columns should inherit/include the same collation as the referenced PK column.

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "User ran makemigrations and sqlmigrate with models where a primary key field has db_collation set and other models have ForeignKey/OneToOneField references to that primary key.",
  "observed_behavior": "The generated SQL ALTER TABLE statements for foreign key columns (e.g. account_id) are missing the COLLATE clause, causing ADD CONSTRAINT foreign key statements to fail in MySQL.",
  "expected_behavior": "The generated SQL ALTER TABLE statements for foreign key columns should include the same COLLATE clause as the referenced primary key column.",
  "reproduction": "ALTER TABLE `b_manage_address` MODIFY `account_id` varchar(22) NOT NULL;  -- missing COLLATE `utf8_bin`\nALTER TABLE `b_manage_profile` MODIFY `account_id` varchar(22) NULL;  -- missing COLLATE `utf8_bin`",
  "symptom_locations": []
}
```
</details>

<details><summary>Original issue</summary>

```text
Errors with db_collation – no propagation to foreignkeys
Description
	 
		(last modified by typonaut)
	 
Using db_collation with a pk that also has referenced fks in other models causes foreign key constraint errors in MySQL.
With the following models:
class Account(models.Model):
	id = ShortUUIDField(primary_key=True, db_collation='utf8_bin', db_index=True, max_length=22) 
	…
class Address(models.Model):
	id = ShortUUIDField(primary_key=True, db_collation='utf8_bin', db_index=True, max_length=22)
	account = models.OneToOneField(Account, on_delete=models.CASCADE)
	…
class Profile(models.Model)… *(2395 chars)*
```
</details>

### 2. `matplotlib__matplotlib-26291`, variant **typo**, judge: rewrite **clean** / facts **clean**

> `inset_axes` crahes wiht `AttributeError: 'NoneType' object has no attribute '_get_renderer'` in `AnchoredLocatorBase.__call__`.

Typos (seed 1090411706): crashes→crahes, with→wiht

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called `inset_axes(ax, width=1.3, height=0.9)` to create an inset axes on a subplot.",
  "observed_behavior": "AttributeError: 'NoneType' object has no attribute '_get_renderer' is raised when the figure is rendered.",
  "expected_behavior": "An empty inset axes box is added towards the top right of the first subplot.",
  "reproduction": "axins = inset_axes(ax, width=1.3, height=0.9)\nAttributeError: 'NoneType' object has no attribute '_get_renderer'",
  "symptom_locations": [
    "mpl_toolkits/axes_grid1/inset_locator.py",
    "AnchoredLocatorBase.__call__",
    "matplotlib/offsetbox.py",
    "OffsetBox.get_window_extent",
    "matplotlib/_tight_bbox.py"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
[Bug]: Error while creating inset axes using `mpl_toolkits.axes_grid1.inset_locator.inset_axes`
### Bug summary

Unable to create the inset axes in a plot using the code (following the first example on the website as posted [here](https://matplotlib.org/stable/gallery/axes_grid1/inset_locator_demo.html) posted below.

### Code for reproduction

```python
import matplotlib.pyplot as plt
from mpl_toolkits.axes_grid1.inset_locator import inset_axes


fig, (ax, ax2) = plt.subplots(1, 2, figsize=[5.5, 2.8])
axins = inset_axes(ax, width=1.3, height=0.9)
plt.show()
```


### Actual o… *(3844 chars)*
```
</details>

### 3. `sympy__sympy-13647`, variant **file_mention**, judge: rewrite **missing_repro** / facts **clean**

> In `Matrix.col_insert`, when inserting columns into the middle of a matrix, the right portion of the original matrix ends up in the wrong rows — the identity block that should stay in rows 3–5 is showing up in rows 0–2 instead.

Judge evidence (rewrite): "when inserting columns into the middle of a matrix, the right portion of the original matrix ends up in the wrong rows"

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called M.col_insert(3, V) on a 6x6 identity matrix M with a 6x2 matrix V of twos inserted at column 3.",
  "observed_behavior": "The right portion of the original matrix (columns 3–5 of the identity) appears in the top three rows instead of the bottom three rows of the result.",
  "expected_behavior": "The columns to the right of the insertion point should remain aligned with their original rows, producing the correct 6x8 matrix.",
  "reproduction": "M = eye(6); V = 2*ones(6,2); M.col_insert(3, V)\nExpected last 3 cols: identity block in rows 3-5\nActual last 3 cols: identity block shifted to rows 0-2",
  "symptom_locations": [
    "Matrix.col_insert"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
Matrix.col_insert() no longer seems to work correctly.
Example:

```
In [28]: import sympy as sm

In [29]: M = sm.eye(6)

In [30]: M
Out[30]: 
⎡1  0  0  0  0  0⎤
⎢                ⎥
⎢0  1  0  0  0  0⎥
⎢                ⎥
⎢0  0  1  0  0  0⎥
⎢                ⎥
⎢0  0  0  1  0  0⎥
⎢                ⎥
⎢0  0  0  0  1  0⎥
⎢                ⎥
⎣0  0  0  0  0  1⎦

In [31]: V = 2 * sm.ones(6, 2)

In [32]: V
Out[32]: 
⎡2  2⎤
⎢    ⎥
⎢2  2⎥
⎢    ⎥
⎢2  2⎥
⎢    ⎥
⎢2  2⎥
⎢    ⎥
⎢2  2⎥
⎢    ⎥
⎣2  2⎦

In [33]: M.col_insert(3, V)
Out[33]: 
⎡1  0  0  2  2  1  0  0⎤
⎢            … *(1088 chars)*
```
</details>

### 4. `django__django-15280`, variant **rambly**, judge: rewrite **clean** / facts **clean**

> so when you do a nested prefetch with `.only("kind")` on the inner User queryset, accessing `user.profile.user.kind` still fires off an extra query because `kind` ends up in the deferred fields of that prefetched User instance even though it was explicitly included in the `.only()` call, so `user.profile.user.get_deferred_fields()` incorrectly returns `{'kind'}` when it should be empty since we asked for that field.

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "The user fetched a User queryset with `.only(\"email\")` and a nested `Prefetch` that fetches related Profile objects, which in turn prefetch the related User with `.only(\"kind\")`",
  "observed_behavior": "Accessing `user.profile.user.kind` executes an unexpected database query because the inner prefetched User instance incorrectly has `kind` in its deferred fields set",
  "expected_behavior": "Accessing `user.profile.user.kind` should not execute any additional queries since `kind` was explicitly included in the inner `User.objects.only(\"kind\")` queryset",
  "reproduction": "user.profile.user.get_deferred_fields() returns {'kind'}\nAssertionError: 1 != 0 : 1 queries executed, 0 expected\nSELECT \"tests_user\".\"id\", \"tests_user\".\"kind\" FROM \"tests_user\" WHERE \"tests_user\".\"id\" = 1",
  "symptom_locations": [
    "user.profile.user.get_deferred_fields"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
Deferred fields incorrect when following prefetches back to the "parent" object
Description
	
Given the following models:
class User(models.Model):
	email = models.EmailField()
	kind = models.CharField(
		max_length=10, choices=[("ADMIN", "Admin"), ("REGULAR", "Regular")]
	)
class Profile(models.Model):
	full_name = models.CharField(max_length=255)
	user = models.OneToOneField(User, on_delete=models.CASCADE)
I'd expect the following test case to pass:
def test_only_related_queryset(self):
	user = User.objects.create(
		email="test@example.com",
		kind="ADMIN",
	)
	Profile.objects.create(user=u… *(2509 chars)*
```
</details>

### 5. `django__django-16560`, variant **typo**, judge: rewrite **fix_leak** / facts **clean**

> `BaseConstraint` is mssing a `violation_error_code` praam liek `violation_error_message` has.

Judge evidence (rewrite): "`BaseConstraint` is mssing a `violation_error_code` praam"

Typos (seed 2699906234): param→praam, like→liek, missing→mssing

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "User attempts to customize the error code of a ValidationError raised by BaseConstraint.validate",
  "observed_behavior": "Only violation_error_message can be customized on a constraint; there is no parameter to set a custom error code on the raised ValidationError",
  "expected_behavior": "A violation_error_code parameter should be available on BaseConstraint so users can set a descriptive error code without subclassing",
  "reproduction": null,
  "symptom_locations": [
    "BaseConstraint",
    "BaseConstraint.validate"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
Allow to customize the code attribute of ValidationError raised by BaseConstraint.validate
Description
	
It is currently possible to customize the violation_error_message of a ValidationError raised by a constraint but not the code.
I'd like to add a new violation_error_message parameter to BaseConstraint to allow to easily add one.
Currently, to achieve the same result, you have to subclass the constraint to tweak validate to catch and reraise the ValidationError.
Since the documentation recommends to Provide a descriptive error code to the constructor: when raising a ValidationError in ​http… *(840 chars)*
```
</details>

### 6. `django__django-14315`, variant **terse**, judge: rewrite **cause_hint** / facts **cause_hint**

> PostgreSQL client `runshell` returns `{}` instead of `None` for env, so subprocess gets empty environment instead of inheriting `os.environ`.

Judge evidence (rewrite): "returns `{}` instead of `None` for env, so subprocess gets empty environment instead of inheriting `os.environ`"

Judge evidence (facts): "The PostgreSQL client returns an empty dict instead of None for env, causing an empty environment to be passed to the subprocess instead of os.environ."

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "User runs the database client shell (runshell) with environment variables set in os.environ.",
  "observed_behavior": "The PostgreSQL client returns an empty dict instead of None for env, causing an empty environment to be passed to the subprocess instead of os.environ.",
  "expected_behavior": "When no extra environment variables are needed, env should be None so that the subprocess inherits os.environ.",
  "reproduction": "env = {} # returned instead of None\nsubprocess called with empty env instead of os.environ",
  "symptom_locations": [
    "django.db.backends.postgresql.client"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
database client runshell doesn't respect os.environ values in some cases
Description
	 
		(last modified by Konstantin Alekseev)
	 
postgresql client returns empty dict instead of None for env
as a result os.environ is not used and empty env passed
to subprocess.
Bug introduced in ​https://github.com/django/django/commit/bbe6fbb8768e8fb1aecb96d51c049d7ceaf802d3#diff-e98866ed4d445fbc94bb60bedffd5d8cf07af55dca6e8ffa4945931486efc3eeR23-R26
PR ​https://github.com/django/django/pull/14315

```
</details>

### 7. `sympy__sympy-21612`, variant **rambly**, judge: rewrite **clean** / facts **clean**

> Been pulling my hair out over this one — `parse_latex("\\frac{\\frac{a^3+b}{c}}{\\frac{1}{c^2}}")` returns `((a**3 + b)/c)/1/(c**2)` instead of `((a**3 + b)/c)/(1/(c**2))`, so when the denominator of a `\frac` is itself a fraction, the result is wrong because the denominator expression isn't being wrapped in brackets before dividing, causing the whole thing to evaluate incorrectly.

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called parse_latex(\"\\\\frac{\\\\frac{a^3+b}{c}}{\\\\frac{1}{c^2}}\")",
  "observed_behavior": "Returns ((a**3 + b)/c)/1/(c**2), which is mathematically incorrect due to missing brackets around the denominator fraction.",
  "expected_behavior": "Returns ((a**3 + b)/c)/(1/(c**2))",
  "reproduction": ">>> parse_latex(\"\\\\frac{\\\\frac{a^3+b}{c}}{\\\\frac{1}{c^2}}\")\n((a**3 + b)/c)/1/(c**2)",
  "symptom_locations": [
    "sympy.parsing.latex"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
Latex parsing of fractions yields wrong expression due to missing brackets
Problematic latex expression: `"\\frac{\\frac{a^3+b}{c}}{\\frac{1}{c^2}}"`

is parsed to: `((a**3 + b)/c)/1/(c**2)`.

Expected is: `((a**3 + b)/c)/(1/(c**2))`. 

The missing brackets in the denominator result in a wrong expression.

## Tested on

- 1.8
- 1.6.2

## Reproduce:

```
root@d31ef1c26093:/# python3
Python 3.6.9 (default, Jan 26 2021, 15:33:00)
[GCC 8.4.0] on linux
Type "help", "copyright", "credits" or "license" for more information.
>>> from sympy.parsing.latex import parse_latex
>>> pars… *(681 chars)*
```
</details>

### 8. `pytest-dev__pytest-7982`, variant **typo**, judge: rewrite **clean** / facts **clean**

> pytest not following symlinked dirs durig collection, tests inside get skipped.

Typos (seed 731966627): during→durig

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "User runs pytest in a test directory that contains a symlink to a subdirectory.",
  "observed_behavior": "The symlinked directory is skipped and its tests are not collected.",
  "expected_behavior": "The symlinked directory should be followed and its tests collected as usual.",
  "reproduction": "# symlinked directory inside test dir\n# pytest skips it instead of collecting tests within it",
  "symptom_locations": []
}
```
</details>

<details><summary>Original issue</summary>

```text
Symlinked directories not collected since pytest 6.1.0
When there is a symlink to a directory in a test directory, is is just skipped over, but it should be followed and collected as usual.

This regressed in b473e515bc57ff1133fe650f1e7e6d7e22e5d841 (included in 6.1.0). For some reason I added a `follow_symlinks=False` in there, I don't remember why, but it does not match the previous behavior and should be removed.

PR for this is coming up.

```
</details>

### 9. `django__django-15732`, variant **rambly**, judge: rewrite **cause_hint** / facts **cause_hint**

> When running a migration to drop a `unique_together` constraint on a field that also has a primary key constraint, the migration blows up because it finds two unique constraints on the column (`foo_bar_pkey` PRIMARY KEY and `foo_bar_id_1c3b3088c74c3b17_uniq` UNIQUE CONSTRAINT) and doesn't know which one to drop. It should be able to distinguish between the primary key constraint and the unique_together constraint and only drop the latter.

Judge evidence (rewrite): "the migration blows up because it finds two unique constraints on the column (`foo_bar_pkey` PRIMARY KEY and `foo_bar_id_1c3b3088c74c3b17_uniq` UNIQUE CONSTRAINT) and doesn't know which one to drop"

Judge evidence (facts): "The migration fails because it finds multiple unique constraints on the column (the primary key constraint and the unique_together constraint) and expects only one."

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "The user ran a migration to drop a unique_together constraint on a single field that also has its own unique=True (primary key) constraint.",
  "observed_behavior": "The migration fails because it finds multiple unique constraints on the column (the primary key constraint and the unique_together constraint) and expects only one.",
  "expected_behavior": "The migration should successfully drop only the unique_together constraint without being confused by the presence of the primary key constraint on the same field.",
  "reproduction": "Indexes:\n  \"foo_bar_pkey\" PRIMARY KEY, btree (id)\n  \"foo_bar_id_1c3b3088c74c3b17_uniq\" UNIQUE CONSTRAINT, btree (id)",
  "symptom_locations": []
}
```
</details>

<details><summary>Original issue</summary>

```text
Cannot drop unique_together constraint on a single field with its own unique=True constraint
Description
	
I have an erroneous unique_together constraint on a model's primary key (unique_together = (('id',),)) that cannot be dropped by a migration. Apparently the migration tries to find all unique constraints on the column and expects there to be only one, but I've got two — the primary key and the unique_together constraint:
Indexes:
	"foo_bar_pkey" PRIMARY KEY, btree (id)
	"foo_bar_id_1c3b3088c74c3b17_uniq" UNIQUE CONSTRAINT, btree (id)
Database is PostgreSQL, if that makes any difference.

```
</details>

### 10. `sympy__sympy-20916`, variant **typo**, judge: rewrite **clean** / facts **clean**

> gerek letters wtih numeric subscripts print the digit as ascii intead of unicode subscript (e.g., `ω0` instead of `ω₀`).

Typos (seed 3668694920): greek→gerek, with→wtih, instead→intead

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "User pretty-prints an expression containing Greek letters with numeric subscripts (e.g., ω₀).",
  "observed_behavior": "The subscript digit is rendered as a plain ASCII digit after the Greek letter (e.g., ω0) instead of a Unicode subscript character.",
  "expected_behavior": "The subscript digit should be rendered as a Unicode subscript character (e.g., ω₀).",
  "reproduction": "Bad:\n[ -t₀⋅ω0   -t₁⋅ω0   -t₂⋅ω0]\nExpected:\n[ -t₀⋅ω₀   -t₁⋅ω₀   -t₂⋅ω₀]",
  "symptom_locations": []
}
```
</details>

<details><summary>Original issue</summary>

```text
pprint unicode does not format subscripts on Greek letters
Good:

[ -t₀⋅w₀   -t₁⋅w₀   -t₂⋅w₀]


Bad:

[ -t₀⋅ω0   -t₁⋅ω0   -t₂⋅ω0]




```
</details>

### 11. `sympy__sympy-24213`, variant **rambly**, judge: rewrite **fix_leak** / facts **clean**

> So `_collect_factor_and_dimension` in `unitsystem.py` is throwing a `ValueError` when you try to add quantities that have equivalent but not identical dimensions, like `velocity` and `acceleration*time` — it's doing a straight equality check instead of checking if the dimensions are actually equivalent, so `a1*t1 + v1` blows up even though those should be the same dimension and the addition should be totally valid.

Judge evidence (rewrite): "it's doing a straight equality check instead of checking if the dimensions are actually equivalent"

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called `SI._collect_factor_and_dimension(expr1)` where `expr1 = a1*t1 + v1` combines quantities of equivalent dimensions (velocity and acceleration*time).",
  "observed_behavior": "A `ValueError` is raised stating that the dimension of `v1` is `Dimension(velocity)` but should be `Dimension(acceleration*time)`.",
  "expected_behavior": "The function should recognize that `Dimension(velocity)` and `Dimension(acceleration*time)` are equivalent dimensions and not raise an error.",
  "reproduction": "ValueError: Dimension of \"v1\" is Dimension(velocity), but it should be Dimension(acceleration*time)",
  "symptom_locations": [
    "sympy/physics/units/unitsystem.py",
    "_collect_factor_and_dimension"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
collect_factor_and_dimension does not detect equivalent dimensions in addition
Code to reproduce:
```python
from sympy.physics import units
from sympy.physics.units.systems.si import SI

v1 = units.Quantity('v1')
SI.set_quantity_dimension(v1, units.velocity)
SI.set_quantity_scale_factor(v1, 2 * units.meter / units.second)

a1 = units.Quantity('a1')
SI.set_quantity_dimension(a1, units.acceleration)
SI.set_quantity_scale_factor(a1, -9.8 * units.meter / units.second**2)

t1 = units.Quantity('t1')
SI.set_quantity_dimension(t1, units.time)
SI.set_quantity_scale_factor(t1, 5 * units.s… *(1023 chars)*
```
</details>

### 12. `sympy__sympy-11618`, variant **rambly**, judge: rewrite **cause_hint** / facts **fix_leak**

> So `Point.distance` is silently dropping coordinates when the two points have different dimensions, like `Point(2,0).distance(Point(1,0,2))` returns 1 instead of sqrt(5) — it seems like it's just zipping the coordinates and stopping at the shorter point's length, when it should be treating any missing coordinates as 0 and including all dimensions in the calculation.

Judge evidence (rewrite): "it seems like it's just zipping the coordinates and stopping at the shorter point's length"

Judge evidence (facts): "treating missing coordinates as 0 when zipping points of different dimensions"

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called `Point(2,0).distance(Point(1,0,2))` to compute the distance between two points of different dimensionality.",
  "observed_behavior": "The function returned 1, ignoring the third dimension of the second point.",
  "expected_behavior": "The function should return sqrt(5), treating missing coordinates as 0 when zipping points of different dimensions.",
  "reproduction": ">>> Point(2,0).distance(Point(1,0,2))\n1  # expected sqrt(5)",
  "symptom_locations": [
    "Point.distance"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
distance calculation wrong
``` python
>>> Point(2,0).distance(Point(1,0,2))
1
```

The 3rd dimension is being ignored when the Points are zipped together to calculate the distance so `sqrt((2-1)**2 + (0-0)**2)` is being computed instead of `sqrt(5)`.


```
</details>

### 13. `django__django-16263`, variant **terse**, judge: rewrite **clean** / facts **clean**

> `Book.objects.annotate(Count('chapters')).count()` includes the unused annotation in SQL instead of stripping it like it should.

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called `Book.objects.annotate(Count('chapters')).count()`",
  "observed_behavior": "The generated SQL includes the unused `Count('chapters')` annotation even though it is not referenced by any filter, other annotation, or ordering.",
  "expected_behavior": "The generated SQL should strip annotations that are not referenced by filters, other annotations, or ordering, producing the same query as `Book.objects.count()`.",
  "reproduction": "Book.objects.annotate(Count('chapters')).count()\n# produces same results as Book.objects.count() but includes unnecessary Count('chapters') in SQL",
  "symptom_locations": []
}
```
</details>

<details><summary>Original issue</summary>

```text
Strip unused annotations from count queries
Description
	
The query below produces a SQL statement that includes the Count('chapters'), despite not not being used in any filter operations.
Book.objects.annotate(Count('chapters')).count()
It produces the same results as:
Book.objects.count()
Django could be more intelligent about what annotations to include in the query produced by queryset.count(), stripping out any annotations that are not referenced by filters, other annotations or ordering. This should speed up calls to count() with complex annotations.
There seems to be precedent for this:… *(656 chars)*
```
</details>

### 14. `django__django-16877`, variant **file_mention**, judge: rewrite **fix_leak** / facts **clean**

> The `escapeseq` template filter doesn't exist yet — need to add it so you can do things like `{{ some_list|escapeseq|join:"," }}`. It should work analogously to `safeseq` but applying `escape` to each element instead of `mark_safe`.

Judge evidence (rewrite): "It should work analogously to `safeseq` but applying `escape` to each element instead of `mark_safe`."

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "The user applies the `escapeseq` template filter to a list and joins it, e.g. `{{ some_list|escapeseq|join:\",\" }}`",
  "observed_behavior": "The `escapeseq` filter does not exist in Django's template filter library",
  "expected_behavior": "A new `escapeseq` filter should be available that escapes each element of a sequence, analogous to how `safeseq` marks each element as safe",
  "reproduction": null,
  "symptom_locations": []
}
```
</details>

<details><summary>Original issue</summary>

```text
New template filter `escapeseq`
Description
	
Following #34574, and after some conversations within the security team, it seems appropriate to provide a new template filter escapeseq which would be to escape what safeseq is to safe. An example of usage would be:
{{ some_list|escapeseq|join:"," }}
where each item of some_list is escaped before applying the join operation. This usage makes sense in a context where autoescape is off.

```
</details>

### 15. `sympy__sympy-15875`, variant **typo**, judge: rewrite **clean** / facts **clean**

> `Add.is_zero` reurns `False` for `-2*I + (1 + I)**2` even though it simlifies to zero.

Typos (seed 1879143667): simplifies→simlifies, returns→reurns

<details><summary>Stage 1 facts</summary>

```json
{
  "user_action": "Called `.is_zero` on the expression `-2*I + (1 + I)**2`",
  "observed_behavior": "`e.is_zero` returns `False` instead of `None` or `True`",
  "expected_behavior": "`is_zero` should return `True` (or at least `None`) because the expression simplifies to zero",
  "reproduction": ">>> e = -2*I + (1 + I)**2\n>>> e.is_zero\nFalse\n>>> simplify(e).is_zero\nTrue",
  "symptom_locations": [
    "Add.is_zero"
  ]
}
```
</details>

<details><summary>Original issue</summary>

```text
is_zero is incorrect on complex integer
`is_zero` should return `None` if it cannot decide, but should never give the wrong answer. However:

```
>>> e = -2*I + (1 + I)**2
>>> e.is_zero
False
>>> simplify(e).is_zero
True
```

This is causing errors in determining the rank of a matrix. See issue #15872 
Fixing is_zero for complex numbers while Add
References to other Issues or PRs
#15873 

Other comments:

<!-- BEGIN RELEASE NOTES -->

- core
  - Fix `is_zero` becoming `False` on some expressions with `Add`.

<!-- END RELEASE NOTES -->


```
</details>

## Criterion 3: the 8 tasks flagged by hand in r2, in r3

| task | variant | r3 rewrite | judge (rewrite / facts) |
|---|---|---|---|
| `django__django-13401` | file_mention | Fields from two different models that inherit the same abstract model field are being treated as equal in `Field.__eq__` / `Field.__hash__`, so putting them in a set deduplicates them: `len({B._meta.get_field('myfield'), C._meta.get_field('myfield')}) == 1` instead of 2. They should compare as unequal since they belong to different concrete models. | location_hint / location_hint |
| `django__django-12663` | rambly | Been hitting this annoying issue where calling `.filter(owner_user=user)` with a `SimpleLazyObject` (like you'd get from `request.user`) raises a `TypeError: int() argument must be a string, a bytes-like object or a number, not 'SimpleLazyObject'` — apparently something changed in commit 35431298226165986ad07e91f9d3aca721ff38ec that broke the unwrapping of `SimpleLazyObject` before it gets passed to `get_prep_value` in `django/db/models/fields/__init__.py` and related code in `django/db/models/lookups.py` and `django/db/models/sql/query.py`, so now it blows up instead of resolving the lazy object first like it used to. | cause_hint / fix_leak |
| `django__django-11141` | file_mention | Running migrate with a migrations directory that doesn't have an `__init__.py` (namespace package) fails because the code checks for `__file__` which namespace packages don't have. It should handle this case since migration discovery uses `__path__` anyway. | cause_hint / fix_leak |
| `django__django-11211` | file_mention | `prefetch_related` on a GenericForeignKey returns `None` for the related object when the target model uses a UUIDField as its primary key. Should be returning the actual related instance instead. | clean / clean |
| `django__django-15280` | rambly | so when you do a nested prefetch with `.only("kind")` on the inner User queryset, accessing `user.profile.user.kind` still fires off an extra query because `kind` ends up in the deferred fields of that prefetched User instance even though it was explicitly included in the `.only()` call, so `user.profile.user.get_deferred_fields()` incorrectly returns `{'kind'}` when it should be empty since we asked for that field. | clean / clean |
| `django__django-11734` | rambly | Using `OuterRef()` inside `exclude()` or `filter(~Q())` within an `Exists()` subquery throws a `ValueError: This queryset contains a reference to an outer query and may only be used in a subquery`, even though the queryset IS being used in a subquery via `Exists()`. The same thing works fine when using `filter()` with `OuterRef()` instead of `exclude()`, so it seems like `exclude()` is somehow triggering an eager evaluation or count check that doesn't respect the subquery context. | cause_hint / clean |
| `matplotlib__matplotlib-23476` | rambly | Every time you pickle/unpickle a figure the DPI doubles (200 → 400 → 800 → ...) and eventually blows up with an OverflowError in the MacOSX backend canvas initializer, so after a few cycles you can't use the figure at all. Expected behavior is that the DPI stays at 200.0 across pickle/unpickle cycles, but something in `figure.py` or `backend_bases.py` is accumulating the DPI each time `dump_load_get_dpi` runs through the `run` loop. | cause_hint / clean |
| `sympy__sympy-16766` | typo | `pycode(IndexedBase('p')[0])` prints a "not supported in python" comment for `Indexed` eevn though `p[0]` prints fine. | clean / clean |

## Stopping rule applied: r3 FAILED, so there is no r4 and every flagged task is excluded

**92 of 200 tasks excluded; 108 remain.** Excluded tasks are listed in `data/trackc_exclusions.jsonl`. Weights become pool ÷ kept per stratum. The exclusion isn't random (see the bias note below).

| stratum | kept / selected | excluded | new weight (pool ÷ kept) |
|---|---|---|---|
| A_haiku_easy | 21 / 36 | 15 | 7.67 |
| A_haiku_hard | 20 / 46 | 26 | 8.70 |
| B_sonnet | 20 / 35 | 15 | 1.75 |
| C_opus | 20 / 33 | 13 | 1.65 |
| D_none_easy | 5 / 10 | 5 | 3.40 |
| D_none_hard | 22 / 40 | 18 | 3.64 |
| repo | kept / selected | excluded |
|---|---|---|
| astropy | 8 / 10 | 2 |
| django | 37 / 80 | 43 |
| matplotlib | 11 / 17 | 6 |
| mwaskom | 0 / 2 | 2 |
| psf | 3 / 5 | 2 |
| pydata | 5 / 9 | 4 |
| pylint-dev | 3 / 6 | 3 |
| pytest-dev | 3 / 5 | 2 |
| scikit-learn | 2 / 10 | 8 |
| sphinx-doc | 14 / 19 | 5 |
| sympy | 22 / 37 | 15 |

**Bias note:** the judge treats a requested feature as a fix leak (validation: `django-13568`, and several r3 cases like "should support a `keep_attrs` kwarg"). So exclusion removes feature-request tasks more often than bug reports.

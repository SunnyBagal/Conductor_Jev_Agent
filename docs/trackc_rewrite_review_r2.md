# Track C rewrite review: prompt r2

Rewriter `claude-sonnet-4-6`, temperature 0. The rewriter saw only the issue text plus this task's style line. Strata and prior outcomes are hidden.

**Audit (pre-registered: under 10%, i.e. at most 19 of 200):** 7 flagged (3.5%), **PASS**.

**Instruction:** Rewrite this bug report as the short message a developer would type to a coding agent. 1–3 sentences, casual, may be vague or have typos, can mention a file or function name if a developer would know it. Describe only what goes wrong and, if needed, what should happen instead. You may keep a short reproduction if the report has one: an error message, a failing input, or expected vs actual output. Keep it minimal. Do NOT guess the cause, say what to change, or say where to look — even if the bug report does. Do NOT say how hard it is, do NOT hint at severity or effort, do NOT include the solution. Output only the message.

## 15 random r2 rewrites

### 1. `scikit-learn__scikit-learn-12682`, variant **rambly**

> `SparseCoder` with `lasso_cd` doesn't let you pass `max_iter` to the underlying `Lasso`, so it always uses the default 1000 and you get convergence warnings with no way to fix it, like in `plot_sparse_coding.py` — there should be some way to pass extra kwargs through to the underlying estimator.

Audit: none

<details><summary>Original issue</summary>

```text
`SparseCoder` doesn't expose `max_iter` for `Lasso`
`SparseCoder` uses `Lasso` if the algorithm is set to `lasso_cd`. It sets some of the `Lasso`'s parameters, but not `max_iter`, and that by default is 1000. This results in a warning in `examples/decomposition/plot_sparse_coding.py` complaining that the estimator has not converged.

I guess there should be a way for the user to specify other parameters of the estimator used in `SparseCoder` other than the ones provided in the `SparseCoder.__init__` right now.

```
</details>

### 2. `django__django-11211`, variant **file_mention**

> `prefetch_related` with GFK returns None for `foo` when the model uses a UUIDField as PK. The object IDs probably aren't matching because of type mismatch between the UUID pk and the CharField `foo_object_id`.

Audit: none

<details><summary>Original issue</summary>

```text
Prefetch related is not working when used GFK for model that uses UUID field as PK.
Description
	
How to reproduce:
create model with UUID as primary key
class Foo(models.Model):
	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	...
create another model with GFK to model Foo
class Bar(models.Model):
	foo_content_type = models.ForeignKey(
		ContentType, related_name='actor',
		on_delete=models.CASCADE, db_index=True
	)
	foo_object_id = models.CharField(max_length=255, db_index=True)
	foo = GenericForeignKey('foo_content_type', 'foo_object_id')
	...
and try to get queryset with prefetch related (django orm engine return None for attribute foo):
Bar.objects.all().pre… *(959 chars total, shown truncated)*
```
</details>

### 3. `django__django-15957`, variant **typo**

> prefetch_related with Prefetch() objects doesn't support sliced querysets, throws `AssertionError: Cannot filter a query once a slice has been taken.` when you do something like `Post.objects.all()[:3]` as the queryset arg

Audit: none

<details><summary>Original issue</summary>

```text
Prefetch objects don't work with slices
Description
	
​Prefetch() objects does not work with sliced querysets. For example the following code results in AssertionError: Cannot filter a query once a slice has been taken.:
Category.objects.prefetch_related(Prefetch(
	'post_set',
	queryset=Post.objects.all()[:3],
	to_attr='example_posts',
))
This behavior is also mentioned in ​this StackOverflow answer. On the other hand it does not seem to be documented in Django Docs.
Why is it needed?
My use case seems to be a common one: I want to display a list of categories while displaying couple of example objects from each category next to it. If I'm not mistaken there isn't currently an efficient way … *(854 chars total, shown truncated)*
```
</details>

### 4. `django__django-13401`, variant **file_mention**

> Fields from abstract models compare equal across subclasses because `__eq__` only checks `creation_counter`, so `B._meta.get_field('myfield') == C._meta.get_field('myfield')` returns True and putting them in a set deduplicates one away. `__eq__`, `__hash__`, and `__lt__` should also consider `field.model`.

Audit: none

<details><summary>Original issue</summary>

```text
Abstract model field should not be equal across models
Description
	
Consider the following models:
class A(models.Model):
	class Meta:
		abstract = True
	myfield = IntegerField()
class B(A):
	pass
class C(A):
	pass
If I pull the fields of B and C into a shared set, one will be de-duplicated away, because they compare as equal. I found this surprising, though in practice using a list was sufficient for my need. The root of the issue is that they compare equal, as fields only consider self.creation_counter when comparing for equality.
len({B._meta.get_field('myfield'), C._meta.get_field('myfield')}) == 1
B._meta.get_field('myfield') == C._meta.get_field('myfield')
We should adjust __eq__ so t… *(1234 chars total, shown truncated)*
```
</details>

### 5. `sympy__sympy-18763`, variant **file_mention**

> `latex(3*Subs(-x+y, (x,),(1,)))` doesn't parenthesize the `Subs` expression when it should, getting `3 \left. - x + y \right|...` instead of `3 \left. \left(- x + y\right) \right|...`

Audit: none

<details><summary>Original issue</summary>

```text
Incorrect parenthesizing of Subs
Here is an example.
```python
>>> from sympy import Subs
>>> from sympy.abc import x,y
>>> 3*Subs(-x+y, (x,),(1,))
```
LaTeX printing of this gives:  
```python
'3 \\left. - x + y \\right|_{\\substack{ x=1 }}'
```

![image](https://quicklatex.com/cache3/76/ql_9672fd7e62c909ff3d9ac8543c2e2576_l3.png)


It would be better to be parenthesized to:  
```python
'3 \\left. \\left(- x + y\\right) \\right|_{\\substack{ x=1 }}'
```

![image](https://quicklatex.com/cache3/bf/ql_936ffdb876e784206d4c54bb93d28dbf_l3.png)


```
</details>

### 6. `django__django-12663`, variant **rambly**

> filtering a queryset with a SimpleLazyObject value breaks when the lhs is a nested subquery annotation — it tries to call `int()` on the SimpleLazyObject directly instead of resolving it first, which used to work fine before that commit. the `get_prep_lookup` or whatever handles rhs prep needs to unwrap lazy objects before passing them along.

Audit: none

<details><summary>Original issue</summary>

```text
Using SimpleLazyObject with a nested subquery annotation fails.
Description
	 
		(last modified by Jordan Ephron)
	 
Prior to 35431298226165986ad07e91f9d3aca721ff38ec it was possible to use a SimpleLazyObject in a queryset as demonstrated below. This new behavior appears to be a regression.
Models
from django.contrib.auth.models import User
from django.db import models
class A(models.Model):
	pass
class B(models.Model):
	a = models.ForeignKey(A, on_delete=models.CASCADE)
class C(models.Model):
	owner = models.ForeignKey(User, on_delete=models.CASCADE)
TestCase
from django.contrib.auth.models import User
from django.db.models import OuterRef, Subquery
from django.test import TestCase
from dja… *(2854 chars total, shown truncated)*
```
</details>

### 7. `django__django-16032`, variant **file_mention**

> `__in` subquery with `alias()` after `annotate()` returns too many columns instead of just the pk. Repro in `tests/annotations/tests.py`: `Book.objects.filter(pages__gt=400).annotate(book_annotate=Value(1)).alias(book_alias=Value(1))` used in `Publisher.objects.filter(book__in=long_books_qs)` gives `OperationalError: sub-select returns 10 columns - expected 1`.

Audit: none

<details><summary>Original issue</summary>

```text
__in doesn't clear selected fields on the RHS when QuerySet.alias() is used after annotate().
Description
	
Here is a test case to reproduce the bug, you can add this in tests/annotations/tests.py
	def test_annotation_and_alias_filter_in_subquery(self):
		long_books_qs = (
			Book.objects.filter(
				pages__gt=400,
			)
			.annotate(book_annotate=Value(1))
			.alias(book_alias=Value(1))
		)
		publisher_books_qs = (
			Publisher.objects.filter(
				book__in=long_books_qs
			)
			.values("name")
		)
		self.assertCountEqual(
			publisher_books_qs,
			[
				{'name': 'Apress'},
				{'name': 'Sams'},
				{'name': 'Prentice Hall'},
				{'name': 'Morgan Kaufmann'}
			]
		)
You should get this error:… *(778 chars total, shown truncated)*
```
</details>

### 8. `django__django-14034`, variant **typo**

> multivaluefield with require_all_fields=False ignores required on individual subfields when all values are empty. if mf_0='' and mf_1='' it should fail validation since mf_1 is required=True, but is_valid() returns True

Audit: none

<details><summary>Original issue</summary>

```text
MultiValueField ignores a required value of a sub field
Description
	 
		(last modified by Takayuki Hirai)
	 
A field and a form definition:
from django.forms import (
	Form,
	CharField,
	MultiValueField,
	MultiWidget,
)
class MF(MultiValueField):
	widget = MultiWidget
	def __init__(self):
		fields = [
			CharField(required=False),
			CharField(required=True),
		]
		widget = self.widget(widgets=[
			f.widget
			for f in fields
		], attrs={})
		super(MF, self).__init__(
			fields=fields,
			widget=widget,
			require_all_fields=False,
			required=False,
		)
	def compress(self, value):
		return []
class F(Form):
	mf = MF()
When the form is passed empty values for both sub fields, form.is_valid(… *(1131 chars total, shown truncated)*
```
</details>

### 9. `django__django-15280`, variant **rambly**

> when you do `User.objects.only("email").prefetch_related(...)` with a nested prefetch back to User with `only("kind")`, the inner User instances end up with the wrong deferred fields — they seem to inherit the deferred fields from the outer queryset so accessing `.kind` fires an extra query even though it was explicitly fetched in the inner queryset, `user.profile.user.get_deferred_fields()` returns `{'kind'}` when it shouldn't.

Audit: none

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
	Profile.objects.create(user=user, full_name="Test Tester")
	queryset = User.objects.only("email").prefetch_related(
		Prefetch(
	… *(2509 chars total, shown truncated)*
```
</details>

### 10. `sympy__sympy-17318`, variant **terse**

> `sqrtdenest((3 - sqrt(2)*sqrt(4 + 3*I) + 3*I)/2)` raises IndexError instead of returning the expression unchanged

Audit: none

<details><summary>Original issue</summary>

```text
sqrtdenest raises IndexError
```
>>> sqrtdenest((3 - sqrt(2)*sqrt(4 + 3*I) + 3*I)/2)
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
  File "sympy\simplify\sqrtdenest.py", line 132, in sqrtdenest
    z = _sqrtdenest0(expr)
  File "sympy\simplify\sqrtdenest.py", line 242, in _sqrtdenest0
    return expr.func(*[_sqrtdenest0(a) for a in args])
  File "sympy\simplify\sqrtdenest.py", line 242, in _sqrtdenest0
    return expr.func(*[_sqrtdenest0(a) for a in args])
  File "sympy\simplify\sqrtdenest.py", line 235, in _sqrtdenest0
    return _sqrtdenest1(expr)
  File "sympy\simplify\sqrtdenest.py", line 319, in _sqrtdenest1
    val = _sqrt_match(a)
  File "sympy… *(2310 chars total, shown truncated)*
```
</details>

### 11. `django__django-11141`, variant **file_mention**

> The `__file__` check on the migrations package should be removed since `pkgutil.iter_modules()` uses `__path__` instead, but the check is still there and breaks namespace packages (those without `__init__.py`) when running migrate.

Audit: none

<details><summary>Original issue</summary>

```text
Allow migrations directories without __init__.py files
Description
	 
		(last modified by Tim Graham)
	 
Background: In python 3 a package with no __init__.py is implicitly a namespace package, so it has no __file__ attribute. 
The migrate command currently checks for existence of a __file__ attribute on the migrations package. This check was introduced in #21015, because the __file__ attribute was used in migration file discovery. 
However, in #23406 migration file discovery was changed to use pkgutil.iter_modules (), instead of direct filesystem access. pkgutil. iter_modules() uses the package's __path__ list, which exists on implicit namespace packages.
As a result, the __file__ check is … *(829 chars total, shown truncated)*
```
</details>

### 12. `django__django-11734`, variant **rambly**

> OuterRef inside exclude() or ~Q() crashes with "This queryset contains a reference to an outer query and may only be used in a subquery" even though the same thing works fine with filter(), so it seems like when negating the lookup it's resolving the OuterRef against the wrong model or something and losing the subquery context.

Audit: cause guess ("seems like")

<details><summary>Original issue</summary>

```text
OuterRef in exclude() or ~Q() uses wrong model.
Description
	
The following test (added to tests/queries/test_qs_combinators) fails when trying to exclude results using OuterRef()
def test_exists_exclude(self):
	# filter()
	qs = Number.objects.annotate(
		foo=Exists(
			Item.objects.filter(tags__category_id=OuterRef('pk'))
		)
	).filter(foo=True)
	print(qs) # works
	# exclude()
	qs = Number.objects.annotate(
		foo =Exists(
			Item.objects.exclude(tags__category_id=OuterRef('pk'))
		)
	).filter(foo=True)
	print(qs) # crashes
	# filter(~Q())
	qs = Number.objects.annotate(
		foo =Exists(
			Item.objects.filter(~Q(tags__category_id=OuterRef('pk')))
		)
	).filter(foo=True)
	print(qs) # crashes
It… *(832 chars total, shown truncated)*
```
</details>

### 13. `pydata__xarray-7229`, variant **terse**

> `xr.where(..., keep_attrs=True)` overwrites coord attrs with variable attrs.

Audit: none

<details><summary>Original issue</summary>

```text
`xr.where(..., keep_attrs=True)` overwrites coordinate attributes
### What happened?

#6461 had some unintended consequences for `xr.where(..., keep_attrs=True)`, where coordinate attributes are getting overwritten by variable attributes. I guess this has been broken since `2022.06.0`.

### What did you expect to happen?

Coordinate attributes should be preserved.

### Minimal Complete Verifiable Example

```Python
import xarray as xr
ds = xr.tutorial.load_dataset("air_temperature")
xr.where(True, ds.air, ds.air, keep_attrs=True).time.attrs
```


### MVCE confirmation

- [X] Minimal example — the example is as focused as reasonably possible to demonstrate the underlying issue in xarray.
- … *(2824 chars total, shown truncated)*
```
</details>

### 14. `django__django-13568`, variant **file_mention**

> auth.E003 fires even when USERNAME_FIELD is covered by a UniqueConstraint in Meta.constraints. Should skip the check if the field is included in a total unique constraint.

Audit: none

<details><summary>Original issue</summary>

```text
Skip auth.E003 system check for USERNAME_FIELD with total UniqueConstraints.
Description
	
Defining a user model like this:
class User(AbstractBaseUser):
	username = models.CharField(max_length=30)
	USERNAME_FIELD = "username"
	class Meta:
		constraints = [UniqueConstraint(fields=["username"], name="user_username_unq")]
Will trigger auth.E003:
auth.User: (auth.E003) 'User.username' must be unique because it is named as the 'USERNAME_FIELD'.
Sometimes it’s not preferable to set the field as unique with unique=True as it will create an extra implicit *_like index for CharField and TextField on PostgresSQL. The system check should be extended to check for the presence of USERNAME_FIELD in Model… *(765 chars total, shown truncated)*
```
</details>

### 15. `matplotlib__matplotlib-23476`, variant **rambly**

> every time you unpickle a figure on M1 Mac the dpi doubles, so if you do it in a loop you eventually get an OverflowError in `backend_macosx.py` when creating the canvas. the dpi should stay the same after pickling/unpickling, seems like `__setstate__` in figure.py is somehow applying the device pixel ratio scaling again each time.

Audit: cause guess ("seems like")

<details><summary>Original issue</summary>

```text
[Bug]: DPI of a figure is doubled after unpickling on M1 Mac
### Bug summary

When a figure is unpickled, it's dpi is doubled. This behaviour happens every time and if done in a loop it can cause an `OverflowError`.

### Code for reproduction

```python
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import pickle
import platform

print(matplotlib.get_backend())
print('Matplotlib ver:', matplotlib.__version__)
print('Platform:', platform.platform())
print('System:', platform.system())
print('Release:', platform.release())
print('Python ver:', platform.python_version())


def dump_load_get_dpi(fig):
    with open('sinus.pickle','wb') as file:
      … *(3251 chars total, shown truncated)*
```
</details>

## 10 tasks the r1 audit flagged, as rewritten in r2

Check: the fix or cause guess is gone, and any short reproduction is kept.

### 1. `scikit-learn__scikit-learn-12585`, r2 variant **file_mention**

**r1** (flagged: possible solution ("Need to handle")):

> `clone` breaks when a param value is an estimator class (not instance) — it tries to call `get_params()` on the class itself, which fails. Need to handle `isinstance(estimator, type)` check in `base.py` around line 51.

**r2** (audit: none):

> `clone` in base.py crashes when a parameter value is an estimator class (not instance) — `get_params()` gets called on the class itself, missing `self`. Expected: no error. Actual: `TypeError: get_params() missing 1 required positional argument: 'self'`

<details><summary>Original issue</summary>

```text
clone fails for parameters that are estimator types
#### Description

`clone` fails when one or more instance parameters are estimator types (i.e. not instances, but classes). 

I know this is a somewhat unusual use case, but I'm working on a project that provides wrappers for sklearn estimators (https://github.com/phausamann/sklearn-xarray) and I'd like to store the wrapped estimators as their classes - not their instances - as a parameter inside of a wrapper that behaves like an estimator itself. 

#### Steps/Code to Reproduce

    from sklearn.preprocessing import StandardScaler
    from sklearn.base import clone
    clone(StandardScaler(with_mean=StandardScaler))

#### Expect… *(1422 chars total, shown truncated)*
```
</details>

### 2. `sympy__sympy-16766`, r2 variant **typo**

**r1** (flagged: possible solution ("Need to add")):

> `PythonCodePrinter` doesn't handle `Indexed` so `pycode(p[0])` outputs a "not supported" comment. Need to add `_print_Indexed` to the printer.

**r2** (audit: none):

> `pycode` prints a "not supported" comment for `Indexed` expressions like `p[0]` even though the output is actually valid python. should handle `_print_Indexed` in `PythonCodePrinter`.

<details><summary>Original issue</summary>

```text
PythonCodePrinter doesn't support Indexed 
I use `lambdify()` to generate some functions and save the code for further use. But the generated code for `Indexed` operation has some warnings which can be confirmed by following code;

```
from sympy import *
p = IndexedBase("p")

pycode(p[0])
```
the output is 

```
  # Not supported in Python:
  # Indexed
p[0]
```

We should add following method to `PythonCodePrinter`:

```
def _print_Indexed(self, expr):
    base, *index = expr.args
    return "{}[{}]".format(str(base), ", ".join([self._print(ind) for ind in index]))
```

```
</details>

### 3. `scikit-learn__scikit-learn-25102`, r2 variant **terse**

**r1** (flagged: too long ("4 sentences")):

> Hey, can you make `set_output(transform="pandas")` preserve the original dtypes of the input columns when the transformer doesn't modify values (e.g. feature selectors)? Right now things like `float16` and `category` dtypes get cast to `float64`. Maybe add a `dtypes` arg to `_wrap_in_pandas_container` in `_set_output.py`?

**r2** (audit: none):

> dtypes not preserved when using set_output("pandas") — e.g. float16 and category columns come out as float64

<details><summary>Original issue</summary>

```text
Preserving dtypes for DataFrame output by transformers that do not modify the input values
### Describe the workflow you want to enable

It would be nice to optionally preserve the dtypes of the input using pandas output for transformers #72.
Dtypes can contain information relevant for later steps of the analyses. 
E.g. if I include pd.categorical columns to represent ordinal data and then select features using a sklearn transformer the columns will loose their categorical dtype. This means I loose important information for later analyses steps. 
This is not only relevant for the categorical dtypes, but could expand to others dtypes (existing, future and custom). 
Furthermore, this wou… *(2534 chars total, shown truncated)*
```
</details>

### 4. `pydata__xarray-6938`, r2 variant **typo**

**r1** (flagged: cause guess ("Looks like")):

> `swap_dims()` mutates the original object's data variable dims in some cases. Looks like it's modifying the dims in-place instead of copying when promoting a var to a dimension coordinate.

**r2** (audit: none):

> `swap_dims()` mutates the original dataset in some cases — after calling `ds2.swap_dims(z='lev')`, `ds2['lev'].dims` changes even though it shouldnt. the returned dataset should be a copy, not modifying the original object's variables in place.

<details><summary>Original issue</summary>

```text
`.swap_dims()` can modify original object
### What happened?

This is kind of a convoluted example, but something I ran into. It appears that in certain cases `.swap_dims()` can modify the original object, here the `.dims` of a data variable that was swapped into being a dimension coordinate variable.

### What did you expect to happen?

I expected it not to modify the original object.

### Minimal Complete Verifiable Example

```Python
import numpy as np
import xarray as xr

nz = 11
ds = xr.Dataset(
    data_vars={
        "y": ("z", np.random.rand(nz)),
        "lev": ("z", np.arange(nz) * 10),
        # ^ We want this to be a dimension coordinate
    },
)
print(f"ds\… *(2978 chars total, shown truncated)*
```
</details>

### 5. `sympy__sympy-19346`, r2 variant **typo**

**r1** (flagged: effort/severity hint ("quick")):

> `srepr` doesn't handle `dict` and `set` types, so it just prints the raw symbols instead of their reprs. Should be a quick fix similar to how list/tuple are handled.

**r2** (audit: none):

> srepr doesn't handle dict and set types, prints raw x/y instead of Symbol('x') etc

<details><summary>Original issue</summary>

```text
srepr not printing dict and set properly
`srepr` prints the element in `list` and `tuple` correctly.
```python
>>> from sympy import srepr
>>> from sympy.abc import x,y
>>> srepr([x,y])
[Symbol('x'), Symbol('y')]
>>> srepr((x,y))
(Symbol('x'), Symbol('y'))
```

However, `srepr` prints the elements in `dict` and `set` wrong.
```python
>>> srepr({x, y})
{x, y}
>>> srepr({x: y})
{x: y}
```

Is this behavior intended? If it isn't, fixing it will be an easy job.

```
</details>

### 6. `sympy__sympy-14248`, r2 variant **typo**

**r1** (flagged: cause guess ("Looks like")):

> The printing of MatrixSymbol differences is broken - `A - B` prints as `(-1)*B + A` instead of `A - B`. Looks like the str/pretty/latex printers aren't handling the negative coefficient case for MatAdd terms properly.

**r2** (audit: none):

> matrix symbol subtraction prints weird, like `(-1)*B + (-1)*A*B + A` instead of `A - A*B - B`. happens with str, pretty, and latex printers.

<details><summary>Original issue</summary>

```text
The difference of MatrixSymbols prints as a sum with (-1) coefficient
Internally, differences like a-b are represented as the sum of a with `(-1)*b`, but they are supposed to print like a-b. This does not happen with MatrixSymbols. I tried three printers: str, pretty, and latex: 
```
from sympy import *
A = MatrixSymbol('A', 2, 2)
B = MatrixSymbol('B', 2, 2)
print(A - A*B - B)
pprint(A - A*B - B)
latex(A - A*B - B)
```
Output:
```
(-1)*B + (-1)*A*B + A
-B + -A⋅B + A
'-1 B + -1 A B + A'
```

Based on a [Stack Overflow post](https://stackoverflow.com/q/48826611)

```
</details>

### 7. `sympy__sympy-21596`, r2 variant **typo**

**r1** (flagged: possible solution ("the fix")):

> `S1.intersect(Reals)` is wrong after the fix for #19513 — `imageset` intersection with Reals returns bad results, e.g. `2 in S1.intersect(Reals)` gives True when it should be False. The intersection itself should be `{-1, 1}` not all of S1.

**r2** (audit: none):

> `S1.intersect(Reals)` is returning wrong results — `2 in S1.intersect(Reals)` gives True but should be False. the intersection of that imageset with Reals should only be {-1, 1}

<details><summary>Original issue</summary>

```text
bug in is_subset(Reals)
Solving issue #19513 has given rise to another bug.
Now:
```
In [8]: S1 = imageset(Lambda(n, n + (n - 1)*(n + 1)*I), S.Integers)

In [9]: S1
Out[9]: {n + ⅈ⋅(n - 1)⋅(n + 1) │ n ∊ ℤ}

In [10]: 2 in S1
Out[10]: False

In [11]: 2 in S1.intersect(Reals)
Out[11]: True
```
This output is incorrect.

Correct output is:
```
In [4]: S1
Out[4]: {n + ⅈ⋅(n - 1)⋅(n + 1) │ n ∊ ℤ}

In [5]: 2 in S1
Out[5]: False

In [6]: 2 in S1.intersect(Reals)
Out[6]: False

In [7]: S2 = Reals

In [8]: S1.intersect(S2)
Out[8]: {-1, 1}
```

```
</details>

### 8. `pytest-dev__pytest-6197`, r2 variant **rambly**

**r1** (flagged: cause guess ("looks like")):

> pytest 5.2.3 regression: it's now collecting `__init__.py` files it shouldn't be touching. worked fine in 5.2.2. looks like something changed in the collection logic that causes it to try to import arbitrary `__init__.py` files under the current dir.

**r2** (audit: none):

> so in 5.2.3 pytest started collecting `__init__.py` files it shouldn't be touching, like if you have a package directory with an `__init__.py` that isn't meant to be a test file it'll try to import it and fail. worked fine in 5.2.2 so something regressed between those two versions, it should just ignore `__init__.py` files that aren't part of the test collection.

<details><summary>Original issue</summary>

```text
Regression in 5.2.3: pytest tries to collect random __init__.py files
This was caught by our build server this morning.  It seems that pytest 5.2.3 tries to import any `__init__.py` file under the current directory. (We have some package that is only used on windows and cannot be imported on linux.)

Here is a minimal example using tox that reproduces the problem (I'm running on Debian 10 with Python 3.7.3):
```sh
❯❯❯ mkdir foobar
❯❯❯ echo 'assert False' >! foobar/__init__.py
❯❯❯ cat > tox.ini <<EOF
[tox]
envlist = py37-pytest{522,523}
skipsdist = true

[testenv]
deps =
    pytest522: pytest==5.2.2
    pytest523: pytest==5.2.3
commands = pytest
EOF
❯❯❯ tox
py37-pytest522 in… *(2749 chars total, shown truncated)*
```
</details>

### 9. `sympy__sympy-13877`, r2 variant **terse**

**r1** (flagged: cause guess ("looks like")):

> `_eval_det_bareiss` breaks with symbolic entries (e.g. `det(Matrix([[i + a*j ...]]))` for n>=6), looks like the bareiss algorithm isn't handling symbolic/NaN pivots correctly in `matrices.py`

**r2** (audit: none):

> `det` of symbolic matrix crashes with "Invalid NaN comparison" for n>=6 (e.g. `det(Matrix([[i + a*j for i in range(6)] for j in range(6)]))`), also gives wrong `nan` for n=5.

<details><summary>Original issue</summary>

```text
Matrix determinant raises Invalid NaN comparison with particular symbolic entries
    >>> from sympy import *
    >>> from sympy.abc import a
    >>> f = lambda n: det(Matrix([[i + a*j for i in range(n)] for j in range(n)]))
    >>> f(1)
    0
    >>> f(2)
    -a
    >>> f(3)
    2*a*(a + 2) + 2*a*(2*a + 1) - 3*a*(2*a + 2)
    >>> f(4)
    0
    >>> f(5)
    nan
    >>> f(6)
    Traceback (most recent call last):
      File "<pyshell#4>", line 1, in <module>
            f(6)
      File "<pyshell#2>", line 1, in <lambda>
            f = lambda n: det(Matrix([[i + a*j for i in range(n)] for j in range(n)]))
      File "C:\Users\E\AppData\Local\Programs\Python\Python36\lib\si… *(4361 chars total, shown truncated)*
```
</details>

### 10. `sympy__sympy-13551`, r2 variant **typo**

**r1** (flagged: cause guess ("looks like")):

> The `Product.doit()` is giving wrong results for `Product(n + 1 / 2**k, [k, 0, n-1])` — looks like it's incorrectly simplifying/combining terms instead of leaving it as a proper product. Check the product evaluation logic, probably in `product.py`.

**r2** (audit: none):

> product of n + 1/2**k from k=0 to n-1 gives wrong result, e.g. for n=2 it returns 9/2 but should be 15/2. the .doit() on Product is computing it incorrectly somehow

<details><summary>Original issue</summary>

```text
Product(n + 1 / 2**k, [k, 0, n-1]) is incorrect
    >>> from sympy import *
    >>> from sympy.abc import n,k
    >>> p = Product(n + 1 / 2**k, [k, 0, n-1]).doit()
    >>> print(simplify(p))
    2**(n*(-n + 1)/2) + n**n
    >>> print(p.subs(n,2))
    9/2

This is incorrect- for example, the product for `n=2` is `(2 + 2^0) * (2 + 2^(-1)) = 15/2`. The correct expression involves the [q-Pochhammer symbol](https://www.wolframalpha.com/input/?i=product+of+n+%2B+1%2F2%5Ek+from+k%3D0+to+n-1).

```
</details>

## Full audit: 7 of 200 r2 rewrites flagged

| task | variant | rule | matched | rewrite |
|---|---|---|---|---|
| `django__django-12419` | rambly | cause guess | "seems like" | the default for SECURE_REFERRER_POLICY is None but it should probably be "same-origin" so django apps don't leak referrer info to third party sites by default, seems like a reasonable secure default to have out of the box without requiring any config |
| `pytest-dev__pytest-7205` | typo | possible solution | "should use" | byteswarning when using --setup-show with bytes param, `tw.write("[{}]".format(fixturedef.cached_param))` in setuponly.py does implicit str() on bytes which blows up with -bb. should use saferepr or similar instead |
| `astropy__astropy-13579` | typo | effort/severity hint | "trivial" | `world_to_pixel` on `SlicedLowLevelWCS` gives wrong results when theres a non-trivial PC matrix coupling sliced and unsliced axes. e.g. slicing a 3d wcs at wavelength=0 and calling world_to_pixel on the spatial coord returns `1.8e+11` instead of `49.5` for the first pixel. |
| `sphinx-doc__sphinx-8056` | typo | effort/severity hint | "one line" | when you have multiple params on one line like `x1, x2 : array_like` in a numpy docstring, the type and optional tag don't render correctly in the html output |
| `matplotlib__matplotlib-23476` | rambly | cause guess | "seems like" | every time you unpickle a figure on M1 Mac the dpi doubles, so if you do it in a loop you eventually get an OverflowError in `backend_macosx.py` when creating the canvas. the dpi should stay the same after pickling/unpickling, seems like `__setstate__` in figure.py is somehow applying the device pixel ratio scaling again each time. |
| `pydata__xarray-6599` | typo | cause guess | "looks like" | `polyval` gives wrong results with timedelta64 coords after the recent changes — the values are way off (1e30 range vs expected 1e6). looks like the timedelta conversion is broken somewhere |
| `django__django-11734` | rambly | cause guess | "seems like" | OuterRef inside exclude() or ~Q() crashes with "This queryset contains a reference to an outer query and may only be used in a subquery" even though the same thing works fine with filter(), so it seems like when negating the lookup it's resolving the OuterRef against the wrong model or something and losing the subquery context. |

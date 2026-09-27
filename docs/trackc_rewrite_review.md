# Track C rewrite review (15 random of 200)

Rewriter `claude-sonnet-4-6` (response model `claude-sonnet-4-6`), temperature 0, prompt `r1`. The rewriter saw only the issue text. Strata and prior outcomes are hidden here on purpose.

**Instruction:** Rewrite this bug report as the short message a developer would type to a coding agent. 1–3 sentences, casual, may be vague or have typos, can mention a file or function name if a developer would know it. Do NOT say how hard it is, do NOT hint at severity or effort, do NOT include the solution. Output only the message.

## 1. `django__django-16493`

**Casual prompt:**

> `FileField.deconstruct` is dropping the `storage` kwarg when the callable happens to return `default_storage` — need to check if the original arg was a callable instead of comparing `self.storage` to `default_storage`.

<details><summary>Original issue</summary>

```text
Callable storage on FileField fails to deconstruct when it returns default_storage
Description
	
If the storage argument on a FileField is set to a callable that returns default_storage, it is omitted from the deconstructed form of the field, rather than being included as a reference to the callable as expected.
For example, given a model definition:
from django.core.files.storage import FileSystemStorage, default_storage
from django.db import models
import random
other_storage = FileSystemStorage(location='/media/other')
def get_storage():
	return random.choice([default_storage, other_storage])
class MyModel(models.Model):
	my_file = models.FileField(storage=get_storage)
repeatedly running … *(1141 chars total, shown truncated)*
```
</details>

## 2. `django__django-11734`

**Casual prompt:**

> OuterRef inside exclude() or ~Q() resolves against the wrong model and throws "may only be used in a subquery". Seems like the negation path in query building isn't preserving the outer ref context properly.

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

## 3. `pylint-dev__pylint-7080`

**Casual prompt:**

> `ignore-paths` doesn't work when using `--recursive=y`, files matching the pattern still get linted

<details><summary>Original issue</summary>

```text
`--recursive=y` ignores `ignore-paths`
### Bug description

When running recursively, it seems `ignore-paths` in my settings in pyproject.toml is completely ignored

### Configuration

```ini
[tool.pylint.MASTER]
ignore-paths = [
  # Auto generated
  "^src/gen/.*$",
]
```


### Command used

```shell
pylint --recursive=y src/
```


### Pylint output

```shell
************* Module region_selection
src\region_selection.py:170:0: R0914: Too many local variables (17/15) (too-many-locals)
************* Module about
src\gen\about.py:2:0: R2044: Line with empty comment (empty-comment)
src\gen\about.py:4:0: R2044: Line with empty comment (empty-comment)
src\gen\about.py… *(24770 chars total, shown truncated)*
```
</details>

## 4. `django__django-11728`

**Casual prompt:**

> `replace_named_groups()` doesn't handle the last named group when the pattern doesn't end with `/`. Try `r'entries/(?P<pk>[^/.]+)/relationships/(?P<related_field>\w+)'` — `related_field` won't get replaced.

<details><summary>Original issue</summary>

```text
simplify_regexp() doesn't replace trailing groups.
Description
	
replace_named_groups() fails to replace the final named group if the urlpattern passed in is missing a trailing '/'.
For example, with input r'entries/(?P<pk>[^/.]+)/relationships/(?P<related_field>\w+)' the "related_field" does not get properly replaced. A workaround is to tack on a '/' at the end and then it works.
Code that reproduces this is attached. 
This function is used downstream in Django REST Framework. See issue ​6888

```
</details>

## 5. `django__django-13406`

**Casual prompt:**

> Pickling and unpickling a query from a values()/annotate() queryset loses the `_iterable_class` info, so when you reassign it the queryset returns model instances instead of dicts. Check how `Query` handles pickling/unpickling — probably need to preserve `values_select` or similar state.

<details><summary>Original issue</summary>

```text
Queryset with values()/values_list() crashes when recreated from a pickled query.
Description
	
I am pickling query objects (queryset.query) for later re-evaluation as per ​https://docs.djangoproject.com/en/2.2/ref/models/querysets/#pickling-querysets. However, when I tried to rerun a query that combines values and annotate for a GROUP BY functionality, the result is broken.
Normally, the result of the query is and should be a list of dicts, but in this case instances of the model are returned, but their internal state is broken and it is impossible to even access their .id because of a AttributeError: 'NoneType' object has no attribute 'attname' error.
I created a minimum reproducible examp… *(3084 chars total, shown truncated)*
```
</details>

## 6. `pylint-dev__pylint-4970`

**Casual prompt:**

> When `min-similarity-lines` is 0, the similarity checker should be disabled entirely instead of flagging everything as duplicate.

<details><summary>Original issue</summary>

```text
Setting `min-similarity-lines` to `0` should stop pylint from checking duplicate code
### Current problem

Setting `min-similarity-lines` to `0` in the rcfile doesn't disable checking for duplicate code, it instead treats every line of code as duplicate and raises many errors.

### Desired solution

Setting `min-similarity-lines` to `0` should disable the duplicate code check.

It works that way in many other linters (like flake8). Setting a numerical value in flake8 to `0` (e.g. `max-line-length`) disables that check.

### Additional context

#214 requests being able to disable `R0801`, but it is still open

```
</details>

## 7. `django__django-16032`

**Casual prompt:**

> `__in` subquery with `.annotate().alias()` returns too many columns instead of just the pk. Looks like `alias()` after `annotate()` breaks the field clearing logic in the RHS subquery resolution.

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

## 8. `sympy__sympy-12481`

**Casual prompt:**

> The `Permutation` constructor throws a `ValueError` for non-disjoint cycles like `[[0,1],[0,1]]` but it should just apply them left-to-right and return the result instead of erroring out.

<details><summary>Original issue</summary>

```text
`Permutation` constructor fails with non-disjoint cycles
Calling `Permutation([[0,1],[0,1]])` raises a `ValueError` instead of constructing the identity permutation.  If the cycles passed in are non-disjoint, they should be applied in left-to-right order and the resulting permutation should be returned.

This should be easy to compute.  I don't see a reason why non-disjoint cycles should be forbidden.

```
</details>

## 9. `django__django-14315`

**Casual prompt:**

> `DatabaseClient.settings_to_cmd_args_env` returns `{}` instead of `None` for env in the postgresql backend, so subprocess ignores `os.environ`. Check around the env return value in that method.

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

## 10. `sympy__sympy-20428`

**Casual prompt:**

> `clear_denoms()` returns a bad poly when the result is zero — the underlying DMP has an unstripped leading zero (`[EX(0)]` instead of `[]`), which causes `is_zero` to return False and breaks things like `terms_gcd()`. Need to strip the result in `clear_denoms`.

<details><summary>Original issue</summary>

```text
Result from clear_denoms() prints like zero poly but behaves wierdly (due to unstripped DMP)
The was the immediate cause of the ZeroDivisionError in #17990.

Calling `clear_denoms()` on a complicated constant poly that turns out to be zero:

```
>>> from sympy import *
>>> x = symbols("x")
>>> f = Poly(sympify("-117968192370600*18**(1/3)/(217603955769048*(24201 + 253*sqrt(9165))**(1/3) + 2273005839412*sqrt(9165)*(24201 + 253*sqrt(9165))**(1/3)) - 15720318185*2**(2/3)*3**(1/3)*(24201 + 253*sqrt(9165))**(2/3)/(217603955769048*(24201 + 253*sqrt(9165))**(1/3) + 2273005839412*sqrt(9165)*(24201 + 253*sqrt(9165))**(1/3)) + 15720318185*12**(1/3)*(24201 + 253*sqrt(9165))**(2/3)/(21760395576904… *(3710 chars total, shown truncated)*
```
</details>

## 11. `sympy__sympy-21379`

**Casual prompt:**

> `subs` on expressions like `exp(sinh(Piecewise(...) / z))` with real symbols throws `PolynomialError: Piecewise generators do not make sense`. Happens with `cosh`/`tanh` too, only when symbols are real. Seems like `ask()` is triggering a `cancel()` or similar call on a piecewise expr it shouldn't.

<details><summary>Original issue</summary>

```text
Unexpected `PolynomialError` when using simple `subs()` for particular expressions
I am seeing weird behavior with `subs` for particular expressions with hyperbolic sinusoids with piecewise arguments. When applying `subs`, I obtain an unexpected `PolynomialError`. For context, I was umbrella-applying a casting from int to float of all int atoms for a bunch of random expressions before using a tensorflow lambdify to avoid potential tensorflow type errors. You can pretend the expression below has a `+ 1` at the end, but below is the MWE that I could produce.

See the expression below, and the conditions in which the exception arises.

Sympy version: 1.8.dev

```python
from sympy import … *(1781 chars total, shown truncated)*
```
</details>

## 12. `pytest-dev__pytest-6197`

**Casual prompt:**

> pytest 5.2.3 regression: it's now collecting `__init__.py` files it shouldn't be touching. worked fine in 5.2.2. looks like something changed in the collection logic that causes it to try to import arbitrary `__init__.py` files under the current dir.

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

## 13. `sympy__sympy-16766`

**Casual prompt:**

> `PythonCodePrinter` doesn't handle `Indexed` so `pycode(p[0])` outputs a "not supported" comment. Need to add `_print_Indexed` to the printer.

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

## 14. `sympy__sympy-15875`

**Casual prompt:**

> `is_zero` returns wrong answer for complex Add expressions like `-2*I + (1 + I)**2`, should be `None` not `False`. Breaking matrix rank calculations.

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

## 15. `matplotlib__matplotlib-21568`

**Casual prompt:**

> Datetime axis tick labels look bad/cramped when `usetex=True`, regression from 3.3 to 3.4. Spacing between labels is off.

<details><summary>Original issue</summary>

```text
[Bug]: Datetime axis with usetex is unclear
### Bug summary

The spacing for a datetime axis when using `usetex=True` is unclear in matplotlib version 3.4 when comparing it to 3.3.

### Code for reproduction

```python
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

np.random.seed(1)
matplotlib.rcParams["text.usetex"] = True

dates = pd.date_range("2020-01-01 00:00:00", end="2020-01-01 00:10:00", periods=100)
data = np.random.rand(100)

fig, ax = plt.subplots(constrained_layout=True)
ax.plot(dates, data)
plt.savefig(matplotlib.__version__ + ".png")
```


### Actual outcome

Example of how it look in 3.3.4:
![3 3 4](https://user-images.g… *(1297 chars total, shown truncated)*
```
</details>

## Automated audit: 66 of 200 rewrites flagged

Heuristic regexes over **all** 200 rewrites, flagging effort or severity hints, possible solutions and >3 sentences. They over-flag on purpose: "should return X" is expected behaviour and fine; "should use Y" names a fix. Please judge each one.

| task | rule | matched | rewrite |
|---|---|---|---|
| `matplotlib__matplotlib-26291` | cause guess | "Looks like" | `inset_axes` locator's `__call__` passes `None` as renderer to `get_window_extent`, which then tries to get it from `self.figure` but `self.figure` is `None`. Looks like `AnchoredLocatorBase.__call__` in `inset_locator.py` isn't setting up the figure reference before calling `get_window_extent`. |
| `astropy__astropy-14369` | cause guess | "looks like" | The CDS unit parser is getting the order of division wrong for composite units like `10+3J/m/s/kpc2` and `10-7J/s/kpc2` — looks like something in how it handles multiple `/` separators in `ascii.cds` unit parsing. |
| `matplotlib__matplotlib-22865` | cause guess | "looks like" | edges not showing at the ends of colorbar when drawedges=True and extend='both'. looks like the dividers array is missing the first/last edge points for the extended triangles/rectangles. |
| `psf__requests-1142` | cause guess | "looks like" | GET requests shouldn't be sending a `content-length` header, but it looks like we're always adding it. Need to skip that header when there's no body. |
| `django__django-11163` | possible solution | "check the `if fields` condition" | `model_to_dict(instance, fields=[])` returns all fields instead of empty dict, check the `if fields` condition in model_to_dict, should be `if fields is not None`. |
| `django__django-15572` | cause guess | "Looks like" | Hey, autoreload is broken when TEMPLATES DIRS contains an empty string (e.g. from a bad `os.getenv(...).split(",")` call). Looks like `template_changed` in `django/template/autoreload.py` is always returning True now because empty string gets normalized to the project root via pathlib.Path since 3.2.4. |
| `django__django-15315` | cause guess | "Looks like" | `Field.__hash__` changes after the field is assigned to a model class, which breaks dict lookups. Looks like a regression from #31750 in the `__hash__` method on `Field`. |
| `sympy__sympy-19954` | cause guess | "Looks like" | `minimal_blocks()` throws IndexError when deleting from `num_blocks` and `blocks` lists, can reproduce with `DihedralGroup(18).sylow_subgroup(p=2)`. Looks like the index `i` goes out of range in the `del num_blocks[i], blocks[i]` line in `perm_groups.py`. |
| `sphinx-doc__sphinx-8269` | possible solution | "Should check" | In linkcheck, when `linkcheck_anchors` is True and the server returns an HTTP error (4xx/5xx), we're swallowing the real error and just reporting "Anchor not found" instead. Should check the response status before trying to find the anchor. |
| `django__django-15467` | possible solution | "Need to check" | In `options.py` around line 234, `formfield_for_foreignkey` always overwrites `empty_label` with the default even if the user already set it in kwargs. Need to check if `empty_label` is already in kwargs before setting it. |
| `django__django-14089` | possible solution | "need to add" | `OrderedSet` doesn't support `reversed()` — need to add a `__reversed__` method to the class |
| `pytest-dev__pytest-7982` | possible solution | "Need to remove" | Symlinked dirs aren't being collected, looks like `follow_symlinks=False` got added by mistake somewhere in the directory collection code. Need to remove it. |
| `pytest-dev__pytest-7982` | cause guess | "looks like" | Symlinked dirs aren't being collected, looks like `follow_symlinks=False` got added by mistake somewhere in the directory collection code. Need to remove it. |
| `sympy__sympy-13480` | possible solution | "probably should be" | `coth.eval` in hyperbolic.py has a typo, `cotm` is not defined — probably should be `cothm` or similar variable name |
| `django__django-11603` | possible solution | "Need to add" | `Avg` and `Sum` aggregates are throwing an exception when using DISTINCT (e.g. `Avg('field', distinct=True)`). Need to add DISTINCT support to these aggregate classes like was done for `Count`. |
| `django__django-13417` | possible solution | "Need to check" | `QuerySet.ordered` returns True even when annotate causes a GROUP BY that drops the ORDER BY. Need to check if the query has a group by and no explicit ordering before returning True based on `default_ordering`. |
| `pytest-dev__pytest-7205` | possible solution | "Should use" | In `setuponly.py` around line 69, `tw.write("[{}]".format(fixturedef.cached_param))` blows up with BytesWarning when the param is bytes. Should use `saferepr` or similar instead of implicit str(). |
| `sympy__sympy-16766` | possible solution | "Need to add" | `PythonCodePrinter` doesn't handle `Indexed` so `pycode(p[0])` outputs a "not supported" comment. Need to add `_print_Indexed` to the printer. |
| `django__django-15741` | possible solution | "Need to handle" | `get_format` in `django.utils.formats` crashes with TypeError when passed a lazy string (e.g. `some_date\|date:_('Y-m-d')`). Need to handle lazy format_type parameter, probably just force str on it. |
| `sphinx-doc__sphinx-7910` | possible solution | "Need to handle" | When `__init__` is decorated (e.g. with `functools.wraps`), sphinx can't find the class in `obj.__globals__` so `cls_is_owner` ends up False and the method gets skipped from docs. Need to handle decorated methods when checking class ownership in that napoleon init logic. |
| `scikit-learn__scikit-learn-12585` | possible solution | "Need to handle" | `clone` breaks when a param value is an estimator class (not instance) — it tries to call `get_params()` on the class itself, which fails. Need to handle `isinstance(estimator, type)` check in `base.py` around line 51. |
| `sphinx-doc__sphinx-9230` | cause guess | "looks like" | Param type parsing breaks when type contains a comma like `dict(str, str)` — looks like it's splitting on the comma incorrectly somewhere in the docstring field parsing logic. |
| `django__django-16493` | possible solution | "need to check" | `FileField.deconstruct` is dropping the `storage` kwarg when the callable happens to return `default_storage` — need to check if the original arg was a callable instead of comparing `self.storage` to `default_storage`. |
| `sympy__sympy-19346` | effort/severity hint | "quick" | `srepr` doesn't handle `dict` and `set` types, so it just prints the raw symbols instead of their reprs. Should be a quick fix similar to how list/tuple are handled. |
| `sympy__sympy-13551` | cause guess | "looks like" | The `Product.doit()` is giving wrong results for `Product(n + 1 / 2**k, [k, 0, n-1])` — looks like it's incorrectly simplifying/combining terms instead of leaving it as a proper product. Check the product evaluation logic, probably in `product.py`. |
| `django__django-13837` | possible solution | "Need to use" | `get_child_arguments` in `autoreload.py` only handles `python -m django` but should support any `python -m <pkg>` invocation. Need to use `__main__.__spec__.parent` instead of checking `__file__` against django's path. |
| `django__django-14351` | cause guess | "Looks like" | Using `Q(agent__property_groups__in=property_groups)` in an OR'd filter causes the subquery to select all columns instead of just the id, resulting in "subquery must return only one column" ProgrammingError. Was working in 2.2.5, broke in 3.2. Looks like `default_cols` is staying `True` when it should be limited to just the pk for the `__in` lookup subquery. |
| `sympy__sympy-24213` | possible solution | "Need to check" | `_collect_factor_and_dimension` in `unitsystem.py` fails when adding quantities with equivalent but not identical dimensions (e.g. `velocity` vs `acceleration*time`). Need to check dimensional equivalence instead of strict equality when validating dimensions in the `Add` case. |
| `pydata__xarray-6744` | cause guess | "looks like" | When iterating over a `DataArrayRolling` with `center=True`, the windows aren't actually centered — looks like the `center` kwarg is being ignored in `__iter__`. |
| `sympy__sympy-22914` | possible solution | "need to add" | `PythonCodePrinter` doesn't handle `Min`/`Max` — need to add `_print_Min` and `_print_Max` methods that map to python's builtin `min`/`max`. |
| `pydata__xarray-4966` | possible solution | "need to add" | pydap with `_Unsigned=False` on a uint variable isn't being handled in `variables.py` — need to add the symmetric case where `.kind == "u"` and `unsigned == False` to reinterpret as signed bytes, similar to how `_Unsigned=True` is handled for signed types. |
| `sympy__sympy-13031` | cause guess | "looks like" | `Matrix.hstack` (and probably `vstack`) gives wrong shape when stacking zero-row matrices — looks like it's skipping empty matrices instead of accumulating their columns. Check the `hstack`/`row_join` logic in the matrix class. |
| `sphinx-doc__sphinx-8035` | possible solution | "Need to add" | `:private-members:` should accept a list of specific members like `:members:` does instead of always documenting all private members. Need to add argument support for this option in autodoc. |
| `astropy__astropy-13579` | too long | "4 sentences" | `world_to_pixel` on `SlicedLowLevelWCS` gives wrong results when there's a coupled PC matrix (e.g. spectral-spatial). Slicing out a wavelength axis and calling `world_to_pixel` on the spatial dims returns garbage for one axis. Check how dropped pixel coords are handled in `wcsapi/wrappers/sliced_wcs.py`. |
| `astropy__astropy-14182` | possible solution | "need to add" | `RST.__init__()` doesn't accept `header_rows` kwarg like `fixed_width` does, need to add support for it in the RST writer class |
| `sphinx-doc__sphinx-9658` | cause guess | "Looks like" | When a class inherits from a mocked class, the "Bases" section shows a truncated name like `torch.nn.` instead of the full `torch.nn.Module`. Looks like the class name is getting dropped somewhere when resolving mocked base classes. |
| `psf__requests-2931` | cause guess | "looks like" | Sending binary data as the request body is broken in 2.9, looks like `to_native_string` is being called on the payload somewhere and choking on non-ascii bytes. |
| `django__django-13401` | possible solution | "Need to update" | Fields from abstract models compare equal across subclasses because `__eq__` only checks `creation_counter`, ignoring `field.model`. Need to update `__eq__`, `__hash__`, and `__lt__` in the Field class to account for the model. |
| `django__django-16032` | cause guess | "Looks like" | `__in` subquery with `.annotate().alias()` returns too many columns instead of just the pk. Looks like `alias()` after `annotate()` breaks the field clearing logic in the RHS subquery resolution. |
| `sympy__sympy-14711` | possible solution | "need to handle" | `Vector.__add__` breaks when adding 0 (e.g. from `sum()`), need to handle the zero case like the commented out line suggests in `vector.py` |
| `pydata__xarray-3993` | possible solution | "should use" | `DataArray.integrate` uses `dim` arg but should use `coord` to match `Dataset.integrate` and `differentiate` |
| `scikit-learn__scikit-learn-25102` | too long | "4 sentences" | Hey, can you make `set_output(transform="pandas")` preserve the original dtypes of the input columns when the transformer doesn't modify values (e.g. feature selectors)? Right now things like `float16` and `category` dtypes get cast to `float64`. Maybe add a `dtypes` arg to `_wrap_in_pandas_container` in `_set_output.py`? |
| `scikit-learn__scikit-learn-14087` | cause guess | "looks like" | `LogisticRegressionCV` with `refit=False` throws IndexError in logistic.py around line 2193-2194, looks like `coefs_paths` indexing is wrong for the non-refit case. |
| `django__django-16938` | possible solution | "Need to handle" | Serializing m2m fields breaks when the related model has a custom manager that uses `select_related` in `get_queryset`. The serializer applies `only()` for optimization (#33937) which conflicts with the manager's `select_related`, throwing a `FieldError`. Need to handle this in `handle_m2m_field` or the queryset setup in `python.py`. |
| `sphinx-doc__sphinx-8638` | too long | "4 sentences" | Instance variables are autolinking to other variables with the same name in the project (e.g. `somepackage::Foo.somename` linking to `somepackage.somename`). This happens across classes and subpackages too. The py domain's reference resolution is being way too aggressive when matching variable names. |
| `sphinx-doc__sphinx-8265` | cause guess | "Looks like" | Tuple default args in docstrings are being rendered incorrectly in HTML — the parentheses get stripped so `color=(1, 1, 1)` shows up as `color=1, 1, 1`. Looks like something in autodoc signature parsing is dropping the parens around tuple defaults. |
| `pytest-dev__pytest-6197` | cause guess | "looks like" | pytest 5.2.3 regression: it's now collecting `__init__.py` files it shouldn't be touching. worked fine in 5.2.2. looks like something changed in the collection logic that causes it to try to import arbitrary `__init__.py` files under the current dir. |
| `sympy__sympy-21379` | cause guess | "Seems like" | `subs` on expressions like `exp(sinh(Piecewise(...) / z))` with real symbols throws `PolynomialError: Piecewise generators do not make sense`. Happens with `cosh`/`tanh` too, only when symbols are real. Seems like `ask()` is triggering a `cancel()` or similar call on a piecewise expr it shouldn't. |
| `pydata__xarray-6938` | cause guess | "Looks like" | `swap_dims()` mutates the original object's data variable dims in some cases. Looks like it's modifying the dims in-place instead of copying when promoting a var to a dimension coordinate. |
| `django__django-13406` | possible solution | "probably need to preserve" | Pickling and unpickling a query from a values()/annotate() queryset loses the `_iterable_class` info, so when you reassign it the queryset returns model instances instead of dicts. Check how `Query` handles pickling/unpickling — probably need to preserve `values_select` or similar state. |
| `matplotlib__matplotlib-25960` | cause guess | "looks like" | `wspace` and `hspace` params in `subfigures()` don't do anything, looks like they're not being passed through or used in the layout calculation in figure.py around line 1550 |
| `matplotlib__matplotlib-20676` | cause guess | "Looks like" | SpanSelector with interactive=True is incorrectly expanding axes limits to include 0. Looks like the interactive handles are being added at position 0 before any selection is made, affecting the autoscale. |
| `matplotlib__matplotlib-26208` | cause guess | "Seems like" | When ax1 has a stackplot and you do twinx + plot on ax2, ax1's dataLims get reset to inf. Seems like something in the stackplot/twinx interaction is clobbering the datalims of the original axis. |
| `django__django-12308` | possible solution | "Need to handle" | JSONField shows as Python dict instead of valid JSON in admin readonly view. Need to handle it in `display_for_field` in `django/contrib/admin/utils.py`, probably by calling `prepare_value` on the field. |
| `matplotlib__matplotlib-23476` | cause guess | "Looks like" | Figure DPI doubles every time it's unpickled on M1 Mac (MacOSX backend). Looks like `__setstate__` in figure.py or the macosx canvas init is applying the device pixel ratio scaling again on each unpickle. |
| `astropy__astropy-14365` | possible solution | "Need to make" | The QDP reader in `ascii.qdp` is case-sensitive when parsing commands but it shouldn't be — lowercase `read serr 1 2` causes a crash. Need to make the command parsing case-insensitive. |
| `sympy__sympy-14248` | cause guess | "Looks like" | The printing of MatrixSymbol differences is broken - `A - B` prints as `(-1)*B + A` instead of `A - B`. Looks like the str/pretty/latex printers aren't handling the negative coefficient case for MatAdd terms properly. |
| `sympy__sympy-21596` | possible solution | "the fix" | `S1.intersect(Reals)` is wrong after the fix for #19513 — `imageset` intersection with Reals returns bad results, e.g. `2 in S1.intersect(Reals)` gives True when it should be False. The intersection itself should be `{-1, 1}` not all of S1. |
| `pydata__xarray-6599` | cause guess | "looks like" | `polyval` is broken for timedelta64 coords after the recent changes, giving totally wrong values. looks like the coordinate handling changed somewhere in `polyval` or related timedelta conversion code. |
| `pydata__xarray-7229` | cause guess | "seems like" | `xr.where(..., keep_attrs=True)` is overwriting coordinate attrs with variable attrs, seems like a regression from #6461. the lambda change in `duck_array_ops.py` or wherever `where` calls `apply_ufunc` is probably causing coord attrs to get clobbered. |
| `django__django-11734` | cause guess | "Seems like" | OuterRef inside exclude() or ~Q() resolves against the wrong model and throws "may only be used in a subquery". Seems like the negation path in query building isn't preserving the outer ref context properly. |
| `sympy__sympy-20428` | possible solution | "Need to strip" | `clear_denoms()` returns a bad poly when the result is zero — the underlying DMP has an unstripped leading zero (`[EX(0)]` instead of `[]`), which causes `is_zero` to return False and breaks things like `terms_gcd()`. Need to strip the result in `clear_denoms`. |
| `sympy__sympy-17630` | possible solution | "Need to make" | `_blockmul` returns scalar `Zero` instead of `ZeroMatrix` for zero blocks, which then breaks `colblocksizes`/`rowblocksizes` on the result. Need to make sure zero entries in the block matrix stay as `ZeroMatrix` after multiplication in `blockmatrix.py`. |
| `sympy__sympy-17318` | cause guess | "Looks like" | `sqrtdenest` throws IndexError on some expressions with complex numbers, e.g. `sqrtdenest((3 - sqrt(2)*sqrt(4 + 3*I) + 3*I)/2)`. Looks like `_split_gcd` in radsimp.py crashes when surds is empty tuple. |
| `django__django-16502` | possible solution | "needs to handle" | runserver isn't stripping response body for HEAD requests since #26052 removed that logic from Django. WSGIRequestHandler or the dev server needs to handle this itself like gunicorn/mod_wsgi do. |
| `sympy__sympy-13877` | cause guess | "looks like" | `_eval_det_bareiss` breaks with symbolic entries (e.g. `det(Matrix([[i + a*j ...]]))` for n>=6), looks like the bareiss algorithm isn't handling symbolic/NaN pivots correctly in `matrices.py` |
| `sphinx-doc__sphinx-7590` | possible solution | "Need to add" | C++ user defined literals (like `6.62607015e-34q_J` or `1q_s`) aren't parsed correctly in the cpp domain, causes "Expected end of definition" error. Need to add UDL support in cpp.py around the literal parsing logic. |

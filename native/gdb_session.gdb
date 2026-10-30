set pagination off
set confirm off
set print pretty on
echo \n### 1. Conditional breakpoint on the readiness gate for machine vm-003\n
break assess_readiness if $_streq(m->id, "vm-003")
run
echo \n### 2. Backtrace and inspect the arguments\n
bt
print *m
print *cfg
echo \n### 3. Watch the blocker bit mask while the rules execute\n
watch blockers
continue
print/t blockers
print negative
continue
echo \n### 4. Finish the function and read the verdict\n
finish
echo \n### 5. Break on the automatic-halt rule and test the canary boundary\n
delete
break should_halt
continue
info args
print cfg->max_unhealthy_fraction
finish
echo \n### 6. Evaluate the 10 percent tolerance boundary by hand\n
print (double)1 / 10 > 0.10
print (double)2 / 10 > 0.10
delete
continue

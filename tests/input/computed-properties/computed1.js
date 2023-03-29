function main(){
    let inspect = {
        custom: "custom" 
    };
    class test {
        [inspect.custom]() {
          return 'test';
        }
    };
    let testvar = new test();
    return testvar.custom();
}

main();

import sys

sys.path.insert(0, sys.argv[1])

from pip._internal.cli.main import main

sys.exit(main(sys.argv[2:]))
